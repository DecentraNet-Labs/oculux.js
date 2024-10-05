import {
  IBroadcastOptions,
  IBroadcastOrChainOptions,
  IBuyStorageOptions,
  IChildMetaDataMap,
  ICreateFolderOptions,
  IDeleteTargetOptions,
  IDownloadTracker,
  IFileMetaData,
  IFileParticulars,
  IFolderMetaData,
  IFolderMetaHandler,
  IMoveRenameResourceOptions,
  IProviderIpSet,
  IProviderUploadResponse,
  IReadFolderContentOptions,
  IShareOptions,
  IStagedUploadPackage,
  IStorageStatus,
  IUploadPackage,
  IWrappedEncodeObject,
} from '@/interfaces'
import type { TSharedRootMetaDataMap } from '@/types'

export interface IStorageHandler {
  cleanShutdown (): void

  registerPubKey (options?: IBroadcastOrChainOptions): Promise<IWrappedEncodeObject[]>

  loadDirectory (options?: IReadFolderContentOptions): Promise<void>

  readDirectoryContents (path: string, options?: IReadFolderContentOptions): Promise<IChildMetaDataMap>

  loadShared (): Promise<void>

  listChildFolders (): string[]

  listChildFolderMetas (): IFolderMetaData[]

  listChildFiles (): string[]

  listChildFileMetas (): IFileMetaData[]

  getChildren(): IChildMetaDataMap

  upgradeSigner (): Promise<void>

  getAvailableProviders (): Promise<string[]>

  findProviderIps (providers: string[]): Promise<IProviderIpSet>

  loadProviderPool (providers?: IProviderIpSet): Promise<void>

  initStorage (options?: IBroadcastOrChainOptions): Promise<any>

  planStatus (): Promise<IStorageStatus>

  estimateStoragePlan (options: IBuyStorageOptions): Promise<number>

  purchaseStoragePlan (options: IBuyStorageOptions): Promise<any>

  createFolders (options: ICreateFolderOptions): Promise<IWrappedEncodeObject[]>

  saveFolder (bundle: IStagedUploadPackage): Promise<IWrappedEncodeObject[]>

  moveRenameResource (options: IMoveRenameResourceOptions): Promise<IWrappedEncodeObject[]>

  readActivePath (): string

  readCurrentLocation (): string

  readCurrentUlid (): string

  readChildCount (): number

  readMustConvertStatus (): boolean

  readCurrentQueue (): string[]

  getCurrentQueue(): IUploadPackage[]
  
  getCurrentMeta(): IFolderMetaHandler

  removeFromQueue (name: string): void

  clearQueue(): void

  queuePrivate (toQueue: File | File[], duration?: number): Promise<number>

  queuePublic (toQueue: File | File[], duration?: number): Promise<number>

  processAllQueues (options?: IBroadcastOptions): Promise<void>

  uploadFile(
    url: string,
    startBlock: number,
    file: File,
    merkle: string,
  ): Promise<IProviderUploadResponse>

  getFileParticulars (filePath: string): Promise<IFileParticulars>

  downloadFile (filePath: string, trackers: IDownloadTracker): Promise<File>

  downloadExternalFile (
    userAddress: string,
    filePath: string,
    trackers: IDownloadTracker,
  ): Promise<File>

  deleteTargets (options: IDeleteTargetOptions): Promise<IWrappedEncodeObject[]>

  share (options: IShareOptions): Promise<IWrappedEncodeObject[]>

  checkNotifications (): Promise<number>

  processPendingNotifications (): Promise<TSharedRootMetaDataMap>

  readSharing (): TSharedRootMetaDataMap

  convert (options?: IBroadcastOrChainOptions): Promise<IWrappedEncodeObject[]>
}
