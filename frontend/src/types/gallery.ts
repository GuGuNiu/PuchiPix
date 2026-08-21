export interface GalleryDownloadInfoData {
  ID: number;
  GalleryID: number;
  Title: string;
  FileCount: number;
  FileSizeText: string;
  ImageDimensions: string;
  Password: string;
  DownloadURL: string;
  DownloadSource: string;
  OuoURL: string;
  ResolvedDirectURL: string;
  Provider: string;
  RequiresLogin: boolean;
  RequiresEmail: boolean;
  Status: string;
  LocalPath: string;
  ExtractedPath: string;
  ActualSize: number;
  ZipFileName: string;
  Parallelism: number;
  AvgSpeed: number;
  VerifiedCount: number;
  CountMatched: boolean;
}

export interface GalleryData {
  ID: number;
  Seq?: string;
  SourceURL: string;
  SiteID: string;
  ScrapedDomain: string;
  Title: string;
  Protagonist: string;
  Description: string;
  Category: string;
  Tags: string[];
  CoverURL: string;
  CoverLocalPath: string;
  PublishTime?: string;
  ImageCount: number;
  VideoCount: number;
  PageCount: number;
  Status: string;
  DownloadMethod: string;
  ExpectedImageCount: number;
  ExpectedVideoCount: number;
  ContentVerified: boolean;
  SavePath: string;
  TotalSize: number;
  DownloadedSize: number;
  CreatedAt: string;
  UpdatedAt: string;
  Images?: GalleryImageData[];
  Videos?: GalleryVideoData[];
  DownloadInfo?: GalleryDownloadInfoData;
  GameCharacters?: string[];
}

export interface GalleryImageData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  PageIndex: number;
  OrderIndex: number;
  Status: string;
}

export interface GalleryVideoData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  Status: string;
  FileSize?: number;
  Duration?: number;
  Resolution?: string;
  Format?: string;
  ErrorMsg?: string;
}
