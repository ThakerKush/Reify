import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { BaseError } from "../errors/baseError.js";
import config from "../config/index.js";
import { Err, Ok, type Result } from "../errors/result.js";
import { logger } from "../utils/log.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";

export class S3Error extends BaseError {
  operation: string;
  details?: Record<string, unknown>;

  constructor(
    operation: string,
    message: string,
    details?: Record<string, unknown>,
    source = "s3-service"
  ) {
    super("S3_ERROR", message, source);
    this.operation = operation;
    this.details = details;
  }

  public static connectionFailed(message: string): S3Error {
    return new S3Error("connection", message, {}, "s3-service");
  }

  public static uploadFailed(key: string, error: unknown): S3Error {
    return new S3Error(
      "upload",
      `Upload failed: ${key}`,
      { error, key },
      "s3-service"
    );
  }

  public static downloadFailed(key: string, error: unknown): S3Error {
    return new S3Error(
      "download",
      `Download failed: ${key}`,
      { error, key },
      "s3-service"
    );
  }

  public static notFound(key: string): S3Error {
    return new S3Error("not_found", `Object not found: ${key}`, { key });
  }

  public static bucketCreationFailed(bucket: string, error: unknown): S3Error {
    return new S3Error(
      "bucket_creation",
      `Failed to create bucket: ${bucket}`,
      { error, bucket }
    );
  }
}

export interface UploadResult {
  key: string;
  etag: string;
  location: string;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
}

export interface FileMetadata {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

const log = logger.child({ service: "s3" });
export let s3: S3Client;

const {
  bucketName,
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
} = config.s3;
export const setupS3 = async () => {
  log.info({ bucketName, endpoint, region }, "Initializing S3 service...");
  s3 = new S3Client({
    endpoint: endpoint,
    region: region,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    forcePathStyle: forcePathStyle,
  });
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
      })
    );
    log.info(`Created bucket: ${bucketName}`);
  } catch (error: any) {
    if (
      error.name === "BucketAlreadyOwnedByYou" ||
      error.name === "BucketAlreadyExists"
    ) {
      log.info(`Bucket already exists: ${bucketName}`);
    } else {
      log.error(error, "Failed to initialize S3 service");
      throw error;
    }
  }
  log.info("S3 service initialized");
};

export const uploadFile = async (
  key: string,
  body: Uint8Array | string | Readable,
  contentType?: string
): Promise<Result<UploadResult, S3Error>> => {
  try {
    logger.info({ service: "s3" }, `Uploading file: ${key}`);

    const command = new Upload({
      client: s3,
      params: {
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
    });

    // Umm make sure that I'm not upliading like 100GBs to s3?
    const response = await command.done();

    const result: UploadResult = {
      key,
      etag: response.ETag || "",
      location: `${endpoint}/${bucketName}/${key}`,
    };

    log.info(`File uploaded successfully: ${key}`);
    return Ok(result);
  } catch (error) {
    log.error(error, `Upload failed for ${key}:`);
    return Err(S3Error.uploadFailed(key, error));
  }
};

export const getFile = async (
  key: string
): Promise<Result<Buffer, S3Error>> => {
  try {
    log.info(`Getting file: ${key}`);

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3.send(command);

    if (!response.Body) {
      return Err(S3Error.notFound(key));
    }

    const buffer = Buffer.from(await response.Body.transformToByteArray());
    log.info(`File retrieved successfully: ${key}`);
    return Ok(buffer);
  } catch (error: any) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return Err(S3Error.notFound(key));
    }

    log.error(error, `Download failed for ${key}:`);
    return Err(S3Error.downloadFailed(key, error));
  }
};

export const getFileStream = async (
  key: string
): Promise<Result<Readable, S3Error>> => {
  try {
    log.info(`Getting file stream ${key}`);
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const response = await s3.send(command);
    if (!response.Body) {
      return Err(S3Error.notFound(key));
    }

    const stream = response.Body as Readable;
    log.info(`File Stream retrieved sucessfully: ${key}`);
    return Ok(stream);
  } catch (error: any) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return Err(S3Error.notFound(key));
    }
    log.error(error, `Stream download failed for ${key}:`);
    return Err(S3Error.downloadFailed(key, error));
  }
};

export const deleteFile = async (
  key: string
): Promise<Result<void, S3Error>> => {
  try {
    logger.info(`Deleting file: ${key}`);

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3.send(command);
    log.info(`File deleted successfully: ${key}`);
    return Ok(undefined);
  } catch (error) {
    log.error(error, `Delete failed for ${key}:`);
    return Err(S3Error.downloadFailed(key, error));
  }
};

export const getFileMetadata = async (
  key: string
): Promise<Result<FileMetadata, S3Error>> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3.send(command);

    const metadata: FileMetadata = {
      key,
      size: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      contentType: response.ContentType,
    };

    return Ok(metadata);
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return Err(S3Error.notFound(key));
    }

    return Err(S3Error.downloadFailed(key, error));
  }
};

export const getUploadUrl = async (
  key: string,
  expiresIn: number = 3600,
  contentType?: string
): Promise<Result<SignedUrlResult, S3Error>> => {
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    logger.info({ service: "s3" }, `Upload URL generated for: ${key}`);
    return Ok({ url, expiresAt });
  } catch (error) {
    log.error(error, `Failed to generate upload URL for ${key}:`);
    return Err(S3Error.uploadFailed(key, error));
  }
};

export const getDownloadUrl = async (
  key: string,
  expiresIn: number = 3600
): Promise<Result<SignedUrlResult, S3Error>> => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const url = await getSignedUrl(s3, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    log.info(`Download URL generated for: ${key}`);
    return Ok({ url, expiresAt });
  } catch (error) {
    log.error(error, `Failed to generate download URL for ${key}:`);
    return Err(S3Error.downloadFailed(key, error));
  }
};

export const end = () => {
  s3.destroy();
};
