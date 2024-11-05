import {
  IFileMetaData,
  IFolderMetaData,
  ILegacyFolderMetaData,
  INullMetaData,
  INullMetaHandler,
  INullRefMetaData,
  IRefMetaData,
  IRootLookupMetaData,
  ISharedMetaDataMap,
  IShareFolderMetaData,
  IShareMetaData,
} from '@/interfaces'

export type TMetaDataTypes =
  | 'folder'
  | 'file'
  | 'ref'
  | 'null'
  | 'nullref'
  | 'share'
  | 'shareref'
  | 'sharefolder'
  | 'rootlookup'
export type TMetaDataSets =
  | TChildMetaData
  | TSharedMetaData
  | IRefMetaData
  | INullRefMetaData
  | ILegacyFolderMetaData
  | IRootLookupMetaData
export type TChildMetaData = INullMetaData | IFolderMetaData | IFileMetaData
export type TSharedMetaData = IShareFolderMetaData | IShareMetaData

export type TMergedMetaData = INullMetaData &
  IFolderMetaData &
  IFileMetaData &
  IRefMetaData &
  IShareFolderMetaData &
  IShareMetaData
export type TFoundationalMetaData = Omit<TMergedMetaData, 'metaDataType'>

export type TChildNullMetaDataMap = Record<number, INullMetaHandler>
export type TChildFolderMetaDataMap = Record<number, IFolderMetaData>
export type TChildFileMetaDataMap = Record<number, IFileMetaData>

export type TSharedRootMetaDataMap = Record<string, ISharedMetaDataMap>
