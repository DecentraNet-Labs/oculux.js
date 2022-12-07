import { EncodeObject } from '@cosmjs/proto-signing'
// import { randomUUID, random } from 'make-random'
import { IQueryStorage } from 'jackal.js-protos'

import { finalizeGas } from '@/utils/gas'
import { hashAndHex, hexFullPath, merkleMeBro } from '@/utils/hash'
import { exportJackalKey, genIv, genKey, importJackalKey } from '@/utils/crypt'
import { checkResults } from '@/utils/misc'
import FileDownloadHandler from '@/classes/fileDownloadHandler'
import FolderHandler from '@/classes/folderHandler'
import WalletHandler from '@/classes/walletHandler'
import { IFileDownloadHandler, IFileIo, IFolderHandler, IProtoHandler, IWalletHandler } from '@/interfaces/classes'
import {
  IDeleteItem,
  IEditorsViewers,
  IFileConfigFull,
  IFileConfigRaw,
  IFileMeta,
  IFiletreeParsedContents,
  IMiner,
  IMsgFinalPostFileBundle,
  IMsgPartialPostFileBundle,
  IProviderModifiedResponse,
  IProviderResponse,
  IQueueItemPostUpload,
  IStray
} from '@/interfaces'
import { TFileOrFFile } from '@/types/TFoldersAndFiles'

export default class FileIo implements IFileIo {
  private readonly walletRef: IWalletHandler
  private readonly pH: IProtoHandler
  private availableProviders: IMiner[]
  private currentProvider: IMiner

  private constructor (wallet: IWalletHandler, providers: IMiner[], currentProvider: IMiner) {
    this.walletRef = wallet
    this.pH = wallet.getProtoHandler()
    this.availableProviders = providers
    this.currentProvider = currentProvider
  }

  static async trackIo (wallet: IWalletHandler): Promise<FileIo> {
    const providers = await getProvider(wallet.getProtoHandler().storageQuery)
    console.dir(providers)
    const provider = providers[await random(providers.length)]
    return new FileIo(wallet, providers, provider)
  }

  async shuffle (): Promise<void> {
    this.availableProviders = await getProvider(await this.pH.storageQuery)
    this.currentProvider = this.availableProviders[await random(this.availableProviders.length)]
  }
  forceProvider (toSet: IMiner): void {
    this.currentProvider = toSet
  }
   async uploadFolders (toUpload: IFolderHandler[], owner: string): Promise<void> {
    const { ip } = this.currentProvider
    const url = `${ip.endsWith('/') ? ip.slice(0, -1) : ip}/u`
    const jackalAddr = this.walletRef.getJackalAddress()

    toUpload[0].setIds(await doUpload(url, jackalAddr, await toUpload[0].getForUpload()))
    const { cfg, file } = await prepExistingUpload(toUpload[1], owner, this.walletRef)
    toUpload[1].setIds(await doUpload(url, jackalAddr, file))

    await this.afterUpload([
      { handler: toUpload[0], data: null },
      { handler: toUpload[1], data: cfg }
    ])
  }
  async uploadFiles (toUpload: TFileOrFFile[], owner: string, existingChildren: { [name: string]: IFileMeta }): Promise<void> {
    if (!toUpload.length) {
      throw new Error('Empty File array submitted for upload')
    } else {
      const { ip } = this.currentProvider
      const url = `${ip.endsWith('/') ? ip.slice(0, -1) : ip}/u`
      const ids: IQueueItemPostUpload[] = await Promise.all(toUpload.map(async (item: TFileOrFFile) => {
        const itemName = item.getWhoAmI()
        const jackalAddr = this.walletRef.getJackalAddress()
        const { cfg, file } = (!existingChildren[itemName] && !item.isFolder)
          ? { cfg: null, file: await item.getForUpload()}
          : await prepExistingUpload(item, owner, this.walletRef)

        item.setIds(await doUpload(url, jackalAddr, file))
        console.log(itemName)
        console.dir(item.getIds())
        return { handler: item, data: cfg }
      }))
      await this.afterUpload(ids)
    }
  }
  private async afterUpload (ids: IQueueItemPostUpload[]): Promise<void> {
    const { msgPostFile } = await this.pH.fileTreeTx
    const { msgSignContract } = await this.pH.storageTx

    const creator = this.walletRef.getJackalAddress()

    const needingReset: EncodeObject[] = []
    const ready = await Promise.all(ids.flatMap(async (item: IQueueItemPostUpload) => {
      const { cid, fid } = item.handler.getIds()
      const msgPostFileBundle: IMsgPartialPostFileBundle = {
        creator,
        // account: (item.data?.owner) ? item.data.owner : await hashAndHex(creator),
        account: await hashAndHex(creator),
        hashParent: await item.handler.getMerklePath(),
        hashChild: await hashAndHex(item.handler.getWhoAmI()),
        contents: JSON.stringify({ fids: fid }),
        viewers: '',
        editors: '',
        trackingNumber: ''
      }
      if (item.data) {
        msgPostFileBundle.viewers = JSON.stringify(item.data.viewingAccess)
        msgPostFileBundle.editors = JSON.stringify(item.data.editAccess)
        msgPostFileBundle.trackingNumber = item.data.trackingNumber
        const delItem = await this.makeDelete(
          creator,
          [
            {
              location: item.handler.getWhereAmI(),
              name: item.handler.getWhoAmI()
            }
          ]
        )
        needingReset.push(...delItem)
      } else {
        const pubKey = this.walletRef.getPubkey()
        const { iv, key } = await item.handler.getEnc()
        const folderView: IEditorsViewers = {}
        const folderEdit: IEditorsViewers = {}
        const perms = JSON.stringify({
          iv: this.walletRef.asymmetricEncrypt(iv, pubKey),
          key: this.walletRef.asymmetricEncrypt(key, pubKey)
        })
        // const workingUUID = await randomUUID()
        const workingUUID = self.crypto.randomUUID()
        folderView[await hashAndHex(`v${workingUUID}${creator}`)] = JSON.parse(perms)
        folderEdit[await hashAndHex(`e${workingUUID}${creator}`)] = JSON.parse(perms)
        msgPostFileBundle.viewers = JSON.stringify(folderView)
        msgPostFileBundle.editors = JSON.stringify(folderEdit)
        msgPostFileBundle.trackingNumber = workingUUID
      }
      console.log(Object.keys(msgPostFileBundle))
      const finalBundle: IMsgFinalPostFileBundle = {
        ...msgPostFileBundle,
        viewersToNotify: '',
        editorsToNotify: '',
        notiForViewers: '',
        notiForEditors: ''
      }
      console.log(Object.keys(finalBundle))

      const msgPost: EncodeObject = await msgPostFile(finalBundle)
      const msgSign: EncodeObject = await msgSignContract({ creator, cid })
      console.log('msgSign')
      console.dir(msgSign)
      return [msgPost, msgSign]
    }))

    ready.unshift(ready.pop() as EncodeObject[])
    const readyToBroadcast = [...needingReset, ...ready.flat()]
    // const readyToBroadcast = [...ready.flat()]
    console.dir(readyToBroadcast)
    checkResults(await this.pH.broadcaster(readyToBroadcast))
    // const lastStep = await this.pH.broadcaster(needingReset, { fee: finalizeGas(needingReset), memo: '' })
    // checkResults(lastStep)
    // const lastStep2 = await this.pH.broadcaster(ready.flat(), { fee: finalizeGas(ready.flat()), memo: '' })
    // checkResults(lastStep2)
  }
   async downloadFile (hexAddress: string, owner: string, isFolder: boolean): Promise<IFileDownloadHandler | IFolderHandler> {
    const hexedOwner = await hashAndHex(`o${hexAddress}${await hashAndHex(owner)}`)
    const { version, data } = await getFileChainData(hexAddress, hexedOwner, this.pH.fileTreeQuery)
    const storageQueryResults = await this.pH.storageQuery.queryFindFile({ fid: version })

    if (!storageQueryResults || !storageQueryResults.providerIps) throw new Error('No FID found!')
    const providers = storageQueryResults.providerIps
    console.dir(providers)
    const targetProvider = JSON.parse(providers)[0]
    if (targetProvider && targetProvider.length) {
      const url = `${targetProvider.endsWith('/') ? targetProvider.slice(0, -1) : targetProvider}/d/${version}`
      return await fetch(url)
        .then(resp => resp.arrayBuffer())
        .then(async (resp): Promise<IFileDownloadHandler | IFolderHandler> => {
          const config = {
            editAccess: JSON.parse(data.editAccess), // json string array of edit access object (to be discussed
            viewingAccess: JSON.parse(data.viewingAccess), // json string of viewing access object (to be discussed)
            trackingNumber: data.trackingNumber // uuid
          }
          const requester = await hashAndHex(`e${config.trackingNumber}${this.walletRef.getJackalAddress()}`)
          console.dir(config.trackingNumber)
          console.log(requester)
          console.dir(config.editAccess)
          const { key, iv } = config.editAccess[requester]
          console.log('pre-crypt')
          console.dir(key)
          console.dir(iv)
          const recoveredKey = await importJackalKey(new Uint8Array(this.walletRef.asymmetricDecrypt(key)))
          const recoveredIv = new Uint8Array(this.walletRef.asymmetricDecrypt(iv))
          console.log('crypt')
          console.dir(recoveredKey)
          console.dir(recoveredIv)
          if (isFolder) {
            return await FolderHandler.trackFolder(resp, config, recoveredKey, recoveredIv)
          } else {
            return await FileDownloadHandler.trackFile(resp, config, recoveredKey, recoveredIv)
          }
        })
    } else {
      throw new Error('No available providers!')
    }
  }
   async deleteTargets (targets: IDeleteItem[], parent: IFolderHandler): Promise<void> {

    const names = targets.map((target:IDeleteItem) => target.name)
    parent.removeChildDirs(names)
    parent.removeChildFiles(names)
    targets.push({
      location: parent.getWhereAmI(),
      name: parent.getWhoAmI()
    })

    const msgs = await this.makeDelete(this.walletRef.getJackalAddress(), targets)

    if (parent) {
      // todo - logic here
    }

    console.dir(await this.pH.broadcaster(msgs))
  }
  /** TODO - Verify this is still valid */
  async generateInitialDirs (startingDirs?: string[]): Promise<void> {
    const { msgMakeRoot, msgPostFile } = await this.pH.fileTreeTx
    const { msgSignContract } = await this.pH.storageTx
    const { ip } = this.currentProvider
    const url = `${ip.replace(/\/+$/, '')}/u`
    const toGenerate = startingDirs || ['Config', 'Home', 'WWW']

    const creator = this.walletRef.getJackalAddress()
    const pubKey = this.walletRef.getPubkey()
    const account = await hashAndHex(creator)

    const initMsg = await WalletHandler.initAccount(this.walletRef, this.pH.fileTreeTx)

    // const rootTrackingNumber = await randomUUID()
    const rootTrackingNumber = self.crypto.randomUUID()
    const rootPermissions: IEditorsViewers = {}
    rootPermissions[await hashAndHex(`e${rootTrackingNumber}${creator}`)] = {
      iv: this.walletRef.asymmetricEncrypt(genIv(), pubKey),
      key: this.walletRef.asymmetricEncrypt(await exportJackalKey(await genKey()), pubKey)
    }
    console.log('merkle')
    console.dir(await merkleMeBro('s'))
    const rootPerms = JSON.stringify(rootPermissions)
    const msgRoot = await msgMakeRoot({
      creator,
      account,
      rootHashPath: await merkleMeBro('s'),
      contents: JSON.stringify({ fids: [] }),
      editors: rootPerms,
      viewers: '',
      trackingNumber: rootTrackingNumber
    })

    // console.dir(await this.pH.broadcaster([msgRoot], { fee: finalizeGas([]), memo: '' }))

    const folderHandlerList: TFileOrFFile[] = []
    for (let i = 0; i < toGenerate.length; i++) {
      const folder = await FolderHandler.trackNewFolder(
        { myName: toGenerate[i], myParent: 's', myOwner: this.walletRef.getJackalAddress()
        })
      folderHandlerList.push(folder)
    }

    const msgs: EncodeObject[][] = await Promise.all(folderHandlerList.map(async (item: TFileOrFFile) => {
      const tmp = await doUpload(url, this.walletRef.getJackalAddress(), await item.getForUpload())
      console.dir(tmp)
      const { cid, fid } = tmp
      console.log('merkle path')
      console.dir(await item.getMerklePath())

      const { iv, key } = await item.getEnc()
      const folderView: IEditorsViewers = {}
      const folderEdit: IEditorsViewers = {}
      const perms = JSON.stringify({
        iv: this.walletRef.asymmetricEncrypt(iv, pubKey),
        key: this.walletRef.asymmetricEncrypt(key, pubKey)
      })
      // const workingUUID = await randomUUID()
      const workingUUID = self.crypto.randomUUID()
      folderView[await hashAndHex(`v${workingUUID}${creator}`)] = JSON.parse(perms)
      folderEdit[await hashAndHex(`e${workingUUID}${creator}`)] = JSON.parse(perms)
      const frame: IMsgFinalPostFileBundle = {
        creator,
        account,
        hashParent: await item.getMerklePath(),
        hashChild: await hashAndHex(item.getWhoAmI()),
        contents: JSON.stringify({ fids: fid }),
        viewers: JSON.stringify(folderView),
        editors: JSON.stringify(folderEdit),
        trackingNumber: workingUUID,
        viewersToNotify: '',
        editorsToNotify: '',
        notiForViewers: '',
        notiForEditors: ''
      }

      const msgPost: EncodeObject = await msgPostFile(frame)
      const msgSign: EncodeObject = await msgSignContract({ creator, cid })
      return [ msgPost, msgSign ]
    }))
    console.dir(msgs.flat())
    const readyToBroadcast = [initMsg, msgRoot, ...msgs.flat()]
    console.dir(await this.pH.broadcaster(readyToBroadcast))
  }

  private async makeDelete (creator: string, targets: IDeleteItem[]): Promise<EncodeObject[]> {
    const { msgDeleteFile } = await this.pH.fileTreeTx
    const { msgCancelContract } = await this.pH.storageTx

    const readyToDelete: EncodeObject[][] = await Promise.all(targets.map(async (target: IDeleteItem) => {
      const hexPath = await hexFullPath(await merkleMeBro(target.location), target.name)
      const hexOwner = await hashAndHex(`o${hexPath}${await hashAndHex(creator)}`)
      const { version } = await getFileChainData(hexPath, hexOwner, this.pH.fileTreeQuery)
      const possibleCids = await this.pH.storageQuery.queryFidCid({ fid: version })
      const cidsToRemove = JSON.parse(possibleCids.fidCid?.cids || '[]')
      const strays: IStray[] = (await this.pH.storageQuery.queryStraysAll({})).strays || []
      const strayCids = strays.map((stray: IStray) => stray.cid)
      const finalCids = cidsToRemove.filter((cid: string) => !strayCids.includes(cid))
      const cancelContractsArr = await Promise.all(finalCids.map(async (cid: string) => {
        return msgCancelContract({ creator, cid })
      }))
      const msgDelFile = await msgDeleteFile({
        creator,
        hashPath: hexPath,
        account: await hashAndHex(creator),
      })
      return [...cancelContractsArr, msgDelFile]
    }))
    return readyToDelete.flat()
  }
}

/** Helpers */
 async function prepExistingUpload (data: TFileOrFFile, ownerAddr: string, walletRef: IWalletHandler): Promise<{ file: File, cfg: IFileConfigFull }> {
  const hexedOwner = await hashAndHex(`o${await data.getFullMerkle()}${await hashAndHex(ownerAddr)}`)
  const fileChainResult = await getFileChainData(await data.getFullMerkle(), hexedOwner, walletRef.getProtoHandler().fileTreeQuery)
  const typedData = fileChainResult.data as IFileConfigRaw

  const configData: IFileConfigFull = {
    address: typedData.address,
    contents: JSON.parse(typedData.contents),
    owner: typedData.owner,
    editAccess: JSON.parse(typedData.editAccess),
    viewingAccess: JSON.parse(typedData.viewingAccess),
    trackingNumber: typedData.trackingNumber
  }

  const editorKeys = configData.editAccess[
    await hashAndHex(`e${configData.trackingNumber}${walletRef.getJackalAddress()}`)
    ]
  const recoveredKey = await importJackalKey(new Uint8Array(walletRef.asymmetricDecrypt(editorKeys.key)))
  const recoveredIv = new Uint8Array(walletRef.asymmetricDecrypt(editorKeys.iv))

  return {
    cfg: configData,
    file: await data.getForUpload(recoveredKey, recoveredIv)
  }
}
async function doUpload (url: string, sender: string, file: File): Promise<IProviderModifiedResponse> {
  const fileFormData = new FormData()
  fileFormData.set('file', file)
  fileFormData.set('sender', sender)
  return await fetch(url, { method: 'POST', body: fileFormData as FormData })
    .then((resp): Promise<IProviderResponse> => resp.json())
    .then((resp) => {
      return { fid: [resp.FID], cid: resp.CID }
    })
}

async function getProvider (queryClient: IQueryStorage): Promise<IMiner[]> {
  const rawProviderReturn = await queryClient.queryProvidersAll({})

  if (!rawProviderReturn || !rawProviderReturn.providers) throw new Error('Unable to get Storage Provider list!')
  const rawProviderList = rawProviderReturn.providers as IMiner[] || []
  return rawProviderList.slice(0, 100)
}
async function getFileChainData (hexAddress: string, owner: string, fTQ: any) {
  const fileTreeQueryResults = await fTQ.queryFiles({ address: hexAddress, ownerAddress: owner })
  console.dir(fileTreeQueryResults)

  if (!fileTreeQueryResults || !fileTreeQueryResults.files) throw new Error('No address found!')
  const fileData = fileTreeQueryResults.files
  const parsedContents: IFiletreeParsedContents = JSON.parse(fileData.contents)
  return {
    version: parsedContents.fids[parsedContents.fids.length - 1],
    data: fileData
  }
}
async function random (max: number) {
   return Math.floor(Math.random() * max)
}
