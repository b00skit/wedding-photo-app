require('dotenv').config();
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
});

const bucketName = process.env.S3_BUCKET_NAME;

// GET
async function downloadPhotos(req, res) {
    const filterUploader = req.query.uploader;

    try {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: 'original/',
            MaxKeys: 1000
        });

        const data = await s3Client.send(command);
        const items = data.Contents || [];

        let files = await Promise.all(items.map(async (item) => {
            const headCommand = new HeadObjectCommand({
                Bucket: bucketName,
                Key: item.Key
            });
            const head = await s3Client.send(headCommand);
            return {
                key: item.Key,
                uploaderName: head.Metadata ? head.Metadata.uploadername : undefined
            };
        }));

        if (filterUploader) {
            files = files.filter(f => f.uploaderName === filterUploader);
        }

        // Return a list of signed URLs or public URLs for the client to download
        const baseUrl = `${process.env.S3_ENDPOINT}/${bucketName}`;
        const urls = files.map(f => `${baseUrl}/${f.key}`);

        res.status(200).send({
            uploader: filterUploader || 'All',
            count: urls.length,
            photos: urls
        });
    } catch(error) {
        console.error(error);
        res.status(500).send({
            message: 'Internal Server Error',
            details: 'Could not prepare download.'
        });
    }
}
  
module.exports = { 
    downloadPhotos
}