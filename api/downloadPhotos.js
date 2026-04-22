require('dotenv').config();
const { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const archiver = require('archiver');
const axios = require('axios');

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

// POST - Download all photos as a ZIP, organized by uploader
async function downloadAll(req, res) {
    if (req.body.password !== process.env.WPA_MANAGE_PASSWORD) {
        return res.status(401).send({
            message: 'Unauthorized',
            details: 'Password does not match.'
        });
    }

    try {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: 'original/',
        });

        const data = await s3Client.send(command);
        const items = data.Contents || [];

        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        res.attachment('wedding-photos.zip');
        archive.pipe(res);

        for (const item of items) {
            // Get metadata to find uploader name
            const headCommand = new HeadObjectCommand({
                Bucket: bucketName,
                Key: item.Key
            });
            const head = await s3Client.send(headCommand);
            const uploaderName = (head.Metadata && head.Metadata.uploadername) || 'Anonymous';
            
            // Get actual object stream
            const getCommand = new GetObjectCommand({
                Bucket: bucketName,
                Key: item.Key
            });
            const { Body } = await s3Client.send(getCommand);

            const fileName = item.Key.split('/').pop();
            const folderName = uploaderName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            archive.append(Body, { name: `${folderName}/${fileName}` });
        }

        archive.finalize();

    } catch(error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).send({
                message: 'Internal Server Error',
                details: 'Could not create zip archive.'
            });
        }
    }
}

// GET - Original downloadPhotos for compatibility
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
    downloadPhotos,
    downloadAll
}