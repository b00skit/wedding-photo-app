/**
 * Transcoding is currently disabled as it is tightly coupled with Azure Media Services.
 * To enable transcoding for S3, a different service (like ffmpeg or a cloud transcoder) would be needed.
 */

async function transcodeVideo(url, transformName = 'default') {
    console.log('Transcoding is disabled for S3 migration.');
    return false;
}

function transcodeJobCompleted(transcodeTransformName, transcodeJobName) {
    return Promise.resolve(false);
}

async function moveTranscodedAsset(assetName, originalBlobName) {
    console.log('Transcoding is disabled for S3 migration.');
}

function getTranscodedBlobName(originalName) {
    return originalName
        .replace(/^original\//, 'transcoded/')
        .replace(/[^\.]*$/, 'mp4');
}

module.exports = {
    getTranscodedBlobName,
    moveTranscodedAsset,
    transcodeJobCompleted,
    transcodeVideo
}
