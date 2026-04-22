require('dotenv').config();

const { S3Client, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true, // often required for non-AWS S3
});

const bucketName = process.env.S3_BUCKET_NAME;
const bucketUrl  = `${process.env.S3_ENDPOINT}/${bucketName}`;
const imageCdnUrl = process.env.IMAGE_CDN_BASE_URL;

// GET
async function getPhotos(req, res) {

    // Pagination options
    let pageSizeFromQuery = parseInt(req.query.pageSize);
    let pageSize = ((pageSizeFromQuery > 0) ? pageSizeFromQuery : 100);
    let pageMarker = req.query.pageMarker || undefined;
    let filterUploader = req.query.uploader || undefined;

    const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'original/',
        MaxKeys: filterUploader ? 1000 : pageSize, // If filtering, we need to fetch more to find matches
        ContinuationToken: pageMarker
    });

    // Get and parse the response data
    try {
        const data = await s3Client.send(command);

        const items = data.Contents || [];
        let marker = data.NextContinuationToken;
        let done = !data.IsTruncated;

        let files = await Promise.all(items.map(async (item) => {
            // S3 ListObjectsV2 does not return metadata. 
            // We need to call HeadObject for each item.
            const headCommand = new HeadObjectCommand({
                Bucket: bucketName,
                Key: item.Key
            });
            const head = await s3Client.send(headCommand);
            const metadata = head.Metadata || {};

            const contentType = head.ContentType || '';

            // If the content is an image and image CDN url is specified, return
            // the CDN-ized url in the response. Otherwise just return the bucket url
            const baseUrl = (contentType && contentType.split('/')[0] === 'image' && imageCdnUrl) ? 
                imageCdnUrl : bucketUrl;

            // Transcoding is disabled for S3 for now
            const transcodedUrl = metadata.transcodedurl;

            return {
                url: `${baseUrl}/${item.Key}`,
                transcodedUrl,
                thumbnail: getThumbnailUrl({ name: item.Key, properties: { contentType } }),
                contentType,
                metaTags: metadata.metatags,
                peopleTags: metadata.peopletags,
                uploaderName: metadata.uploadername,
                name: item.Key // keep name for PATCH/DELETE
            };
        }));

        if (filterUploader) {
            files = files.filter(f => f.uploaderName === filterUploader);
            // Pagination is tricky when filtering server-side without a DB
            // For now we just return what we found in this batch
        }
        
        res.status(200).send({
            files,
            nextPage: marker,
            done
        });
        
    } catch(error) {
        console.error(error);
        res.status(500).send({
            message: 'Internal Server Error',
            details: 'Could not retrieve photos.'
        });
    }
}

// POST
async function createPhotos(req, res) {

    try {

        if (!req.query.targetFilename) {
            return res.status(400).send({
                message: 'Bad Request',
                details: 'targetFilename query parameter is required.'
            });
        }

        const contentType = req.headers["content-type"];
        const extension = getExtensionFromContentType(contentType);
        
        // Handle folder prefix and extensions correctly
        let targetPath = req.query.targetFilename;
        let prefix = 'original/';
        
        if (targetPath.startsWith('original/')) {
            targetPath = targetPath.substring(9);
        } else if (targetPath.startsWith('video_thumbnails/')) {
            prefix = 'video_thumbnails/';
            targetPath = targetPath.substring(17);
        }
        
        const lastDotIndex = targetPath.lastIndexOf('.');
        const pathWithoutExtension = lastDotIndex !== -1 ? targetPath.substring(0, lastDotIndex) : targetPath;
        
        const bucketFilename = `${prefix}${pathWithoutExtension}.${extension}`; 
        const uploaderName = req.query.uploaderName || '';

        const parallelUploads3 = new Upload({
            client: s3Client,
            params: { 
                Bucket: bucketName, 
                Key: bucketFilename, 
                Body: req, 
                ContentType: contentType,
                ACL: 'public-read',
                Metadata: {
                    uploadername: uploaderName
                }
            },
            queueSize: 4,
            partSize: 1024 * 1024 * 5, // 5MB
            leavePartsOnError: false,
        });

        await parallelUploads3.done();

        // Transcoding logic would go here if we had a replacement service
        
        res.status(201).send({ 
            message: 'OK',
            details: 'Files uploaded successfully!' 
        });
        
    } catch(error) {
        console.error(error);
        res.status(500).send({ 
            message: 'Internal Server Error', 
            details: 'Could not upload photos.' 
        });
    }
   
}

// PATCH
async function patchPhotos(req, res) {
    if(!req.body.files) {
        return res.status(400).send({ 
            message: 'Bad Request', 
            details: 'No files supplied.' 
        });
    }

    let outcomes = {
        completed: [],
        failed: [...req.body.files] // assume files haven't been updated
    }

    if(req.body.password !== process.env.WPA_MANAGE_PASSWORD) {
        res.status(401).send({ 
            message: 'Unauthorized', 
            details: 'Password does not match.', 
            outcomes    
        });
    } else {
        const patchOperations = req.body.files.map(async (file, i) => {
            if(!file.metadata) return;

            try {
                // S3 doesn't have a direct "UpdateMetadata" - we have to CopyObject onto itself
                // with new metadata.
                const headCommand = new HeadObjectCommand({
                    Bucket: bucketName,
                    Key: file.name
                });
                const head = await s3Client.send(headCommand);

                const copyCommand = new CopyObjectCommand({
                    Bucket: bucketName,
                    Key: file.name,
                    CopySource: encodeURIComponent(`${bucketName}/${file.name}`),
                    Metadata: {
                        ...head.Metadata,
                        ...file.metadata
                    },
                    MetadataDirective: 'REPLACE',
                    ContentType: head.ContentType
                });

                await s3Client.send(copyCommand);

                outcomes.completed.push(file);
                // Remove from failed (using original index i)
                outcomes.failed[i] = null;
            } catch (error) {
                console.error(`Failed to patch metadata for ${file.name}:`, error);
            }
        });

        await Promise.all(patchOperations);
        outcomes.failed = outcomes.failed.filter(f => f !== null);

        if(outcomes.completed.length < req.body.files.length) {
            res.status(500).send({ 
                message: 'Internal Server Error',
                details: 'Not all files were updated',
                outcomes
            });
        } else {
            res.status(200).send({ 
                message: 'OK',
                details: 'All photos updated',
                outcomes
            });
        }
    }
}

// DELETE
async function deletePhotos(req, res) {
    if(!req.body.files) {
        return res.status(400).send({ 
            message: 'Bad Request', 
            details: 'No files supplied.' 
        });
    }

    let outcomes = {
        completed: [],
        failed: [...req.body.files] // assume files haven't been deleted
    }

    if(req.body.password !== process.env.WPA_MANAGE_PASSWORD) {
        res.status(401).send({ 
            message: 'Unauthorized', 
            details: 'Password does not match.', 
            outcomes    
        });
    } else {
        const deleteOperations = req.body.files.map(async (file, i) => {
            try {
                const command = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: file.name
                });
                await s3Client.send(command);
                outcomes.completed.push(file);
                outcomes.failed[i] = null;
            } catch (error) {
                console.error(`Failed to delete ${file.name}:`, error);
            }
        });

        await Promise.all(deleteOperations);
        outcomes.failed = outcomes.failed.filter(f => f !== null);

        if(outcomes.completed.length < req.body.files.length) {
            res.status(500).send({ 
                message: 'Internal Server Error',
                details: 'Not all files were deleted',
                outcomes
            });
        } else {
            res.status(200).send({ 
                message: 'OK',
                details: 'All photos deleted',
                outcomes
            });
        }
    }
}


// HELPERS

/**
 * Takes the content-type metadata of a file and returns a
 * reasonable extension for the file.
 * @param   {string} contentType 
 * @returns {string}
 */
function getExtensionFromContentType(contentType) {

    if (!contentType) return '';

    const suffix = contentType.split("/")[1];
    
    switch(suffix) {
        
        case 'heic':
        case 'heif':
            return 'heic';
        
        case 'jpeg':
            return 'jpg';
            
        case 'quicktime':
        case 'x-quicktime':
            return 'mov';

        default:
            return suffix;
    }

}

/**
 * Works out the url of the thumbnail image displayed in
 * the photo gallery.
 * @param   {object} item 
 * @returns {string}
 */
function getThumbnailUrl(item) {
    const baseUrl = (imageCdnUrl || bucketUrl);
    const videoThumbs = { base: 'video_thumbnails', extension: 'jpg' };
    let url;

    if (!item.properties || !item.properties.contentType) return '';

    switch(item.properties.contentType.split('/')[0]) {
        case 'image':
            url = `${baseUrl}/${item.name}`;
            break;
            
        case 'video': 
            let thumbFilename = item.name.replace(
                /[^\.]*$/, //capture everything after last '.' in filename
                videoThumbs.extension
            ).replace(
                /^original\//gi, //remove the filename's 'original' prefix
                videoThumbs.base + '/'
            );
            url = `${baseUrl}/${thumbFilename}`;
            break;

        default: 
            break;
    }

    return url;
}
  
module.exports = { 
    getPhotos,
    createPhotos,
    patchPhotos,
    deletePhotos
}