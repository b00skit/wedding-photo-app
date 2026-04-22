const galleryElement = document.getElementById('gallery');
const spinnerElement = document.getElementById('spinner');
const refreshLinkElement = document.getElementById('refreshLink');
const galleryItemElement = document.getElementById('galleryItem');
const galleryItemTemplate = galleryItemElement ? galleryItemElement.content : null;
const uploadBtnElement = document.getElementById('uploadBtn');
const imageFilesElement = document.getElementById('imageFiles');
const uploadFeedbackElement = document.getElementById('uploadFeedback');
const uploadMessageElement  = document.getElementById('uploadFeedbackMsg');
const toastElement = document.getElementById('toast');
const cancelUploadElement = document.getElementById('cancelUpload');
const uploadFormElement = document.getElementById('uploadForm');

if (uploadFormElement) {
    uploadFormElement.addEventListener('submit', (event) => {
        event.preventDefault();
    });
}

function renderPhotoThumbnails(
    pageSize = parseInt(galleryElement?.dataset?.pageSize) || 8, 
    specificPage = undefined, 
    prepend = false
) {
    if(!galleryElement || !galleryItemTemplate) return;

    let pageMarker;

    if(typeof specificPage === "undefined") {
        pageMarker = galleryElement.dataset.nextPage || "";
    } else {
        pageMarker = specificPage;
    }
    
    if(galleryElement.dataset.done === "true" && prepend === false) return;

    // Start spinner & mark window to say a fetch is in progress
    spinnerElement.classList.remove('hidden');
    window.fetchIsRunning = true;

    const uploaderFilter = document.getElementById('uploaderFilter')?.value || '';
    const uploaderParam = uploaderFilter ? `&uploader=${encodeURIComponent(uploaderFilter)}` : '';

    fetch(`/api/photos?pageSize=${pageSize}&pageMarker=${pageMarker}${uploaderParam}`)

        .then(response => {
            if(Math.floor(response.status/100) === 2) {
                return response.json();
            } else {
                throw new Error('Fetch of photo urls from blob storage failed');
            }
        })

        .then(data => {

            // Set the next page marker for the next reload
            // unless the caller asked for a specific page
            // in which case the gallery's "nextPage" and 
            // "done" state remains untouched.
            if(typeof specificPage === "undefined") {
                galleryElement.dataset.nextPage = data.nextPage;

                // If there is no more data, stop further reloads
                // until the user specifies
                galleryElement.dataset.done = (data.done ? "true" : "false");
            }
    
            const filterDropdown = document.getElementById('uploaderFilter');
            const currentFilter = filterDropdown?.value;

            // Populate the gallery
            data.files.forEach((file, i) => {

                const { metaTags, peopleTags, url, uploaderName } = file;
                
                // Add to filter dropdown if not exists
                if (filterDropdown && uploaderName && !Array.from(filterDropdown.options).some(opt => opt.value === uploaderName)) {
                    const option = document.createElement('option');
                    option.value = uploaderName;
                    option.text = uploaderName;
                    filterDropdown.add(option);
                }

                const contentType = file.contentType.split('/')[0];
                const lightboxContentType = (contentType === 'video' ? 
                    'customVideo' : contentType);

                const galleryItem = galleryItemTemplate.cloneNode(true);
                const galleryItemLi = galleryItem.querySelector('li');
                
                // For manage pages, tag each gallery element with the storage bucket file path
                const bucketPathElement = galleryItem.querySelector('.bucketPath');

                if(bucketPathElement) {
                    const bucketPath = file.name;
                    bucketPathElement.innerText = bucketPath;
                    galleryItemLi.dataset.bucketPath = bucketPath;
                }
                
                // For manage pages, attach meta data and people tags to gallery elements
                const metaTagsElement = galleryItem.querySelector('.metaTags');

                if(metaTagsElement && metaTags) {
                    galleryItemLi.metaTags = JSON.parse(metaTags);
                }
                
                const peopleTagsElement = galleryItem.querySelector('.peopleTags');

                if(peopleTagsElement && peopleTags) {
                    galleryItemLi.peopleTags = JSON.parse(peopleTags);
                }

                if(metaTagsElement || peopleTagsElement) {
                    galleryItemLi.dataset.tagsChanged = false; // Track if tags have changed at all
                }

                // Set uploader name if exists
                const uploaderBadge = galleryItem.querySelector('.uploaderBadge');
                if (uploaderBadge) {
                    uploaderBadge.innerText = uploaderName || '';
                    if (!uploaderName) uploaderBadge.classList.add('hidden');
                }

                // Link element
                let linkElement = galleryItem.querySelector('a');

                let thumb = new Image();
                const thumbUrl = getThumbnailUrl(file);
                
                thumb.onerror = replaceThumbnailWithPlaceholder;
                thumb.src = thumbUrl;
                
                console.log("Attempting to load thumbnail:", thumbUrl);

                let videoTemplate, media;

                switch(contentType) {
                    case 'image':
                        linkElement.href = getLightboxUrl(file);
                        break;

                    case 'video': 
                        videoTemplate = document.createElement('template');
                    
                        if("transcodedUrl" in file) {
                            media = document.createElement('video');
                            media.src = getLightboxUrl(file);
                            media.controls = true;
                            media.poster = getThumbnailUrl(file);
                            media.preload = 'none';
                            media.height = window.innerHeight - 100;
                            media.width = window.innerWidth - 100;
                        } 
                        
                        else {
                            media = document.createElement('div');
                            media.classList.add('videoProcessingMessage');
                            media.innerHTML = 
                                `<p>Video processing...</p>
                                 <p>Please refresh the page in a few minutes 
                                    to view this video.</p>`;
                        }

                        const videoIndex = parseInt(galleryElement.dataset.numVideos) + 1;
                        galleryElement.dataset.numVideos = videoIndex;
                        linkElement.href = `#video${videoIndex}`;
                        media.id = `video${videoIndex}`;
                        videoTemplate.appendChild(media);
                        break;

                    default:
                        console.warn('Unrecognised media. Will not display in gallery.');
                        return;
                }

                linkElement.dataset.type = lightboxContentType;
                linkElement.appendChild(thumb);
                if(videoTemplate) linkElement.appendChild(videoTemplate); 
                
                if(prepend) {
                    galleryElement.prepend(galleryItem);
                } else {
                    galleryElement.append(galleryItem);
                }

            });

            // If the gallery is now done, show a message
            if(galleryElement.dataset.done === "true") {

                setRefreshMessages(
                    "No more photos to show.",
                    "Refresh to see newer photos"
                );

                showRefreshLink();
                
            };

        })

        .catch(() => {

            setRefreshMessages(
                "Sorry, an error has occured.",
                "Tap here to try again"
            );

            showRefreshLink();

            galleryElement.dataset.done = "true";

        })

        .finally(() => {
            spinnerElement.classList.add('hidden');
            window.fetchIsRunning = false;
            if(typeof renderTags === "function") renderTags();
            refreshLightbox();
        });
};

function loadMoreOnScroll() {
    throttle(() => {

        if(window.innerHeight + window.pageYOffset >= document.body.offsetHeight) {
            if(window.fetchIsRunning) return;
            renderPhotoThumbnails();
        };

    }, 500);
}

function refreshPhotoThumbnails() {
    if (!galleryElement) return;
    galleryElement.replaceChildren();
    galleryElement.dataset.done = "false";
    galleryElement.dataset.nextPage = "";
    galleryElement.dataset.numVideos = 0;
    renderPhotoThumbnails();
}

function setRefreshMessages(message, action) {
    const messageEl = document.querySelector('#refreshLink .message');
    const actionEl = document.querySelector('#refreshLink .action');
    if (messageEl) messageEl.innerHTML = message;
    if (actionEl) actionEl.innerHTML = action;
}

function showRefreshLink() {
    if(refreshLinkElement && refreshLinkElement.classList.contains('hidden')) {
        refreshLinkElement.classList.remove('hidden');
    }
}

function getThumbnailUrl(file) {
    if(file.thumbnail && file.thumbnail.length > 0) {
        // If it's a relative path to a local placeholder, don't append query strings
        if (file.thumbnail.startsWith('images/')) return file.thumbnail;
        
        // Only append optimization parameters if using a CDN
        // We check if the thumbnail URL contains the S3 endpoint to decide
        const isS3 = file.thumbnail.includes('your-objectstorage.com');
        if (isS3) return file.thumbnail;

        const dpr = (window.devicePixelRatio || 1);
        const h = 195 * dpr;
        const max_w = 260 * dpr;
        const queryString = `?q=44&fit=crop&crop=top,faces&h=${h}&max-w=${max_w}`;
        return file.thumbnail + queryString;
    } else {
        return 'images/placeholder.png';
    }
}

function replaceThumbnailWithPlaceholder(event) {
    console.warn("Thumbnail failed to load, replacing with placeholder:", event.target.src);
    event.target.src = '/images/placeholder.png';

    // We also need to replace the video poster if the thumbnail is broken
    if(event.target.parentElement?.dataset?.type === 'customVideo') {
        const video = event.target.parentElement.querySelector('video');
        if (video) video.poster = '/images/placeholder.png';
    }
}

function uploadFiles(event) {
    const files = event.target.files;
    const numFiles = files.length;
    const uploaderName = document.getElementById('uploaderName')?.value || '';

    if(numFiles === 0) return;

    let fetches = [];
    let controllers = [];

    let outcomes = {
        completed: 0,
        failed: 0
    }

    updateUploadFeedback(`0 of ${numFiles} completed...`);

    showUploadFeedback();

    for(let i = 0; i < numFiles; i++) {

        const descendingIndex = Number.MAX_SAFE_INTEGER - Date.now();
        let targetFilename = `${descendingIndex}-${files[i].name}`;

        let { 
            upload,
            controller 
        } = queueFileUpload(files[i], `original/${targetFilename}`, uploaderName);

        fetches.push(upload);

        controllers.push(controller);

        upload.then((success) => {
            if(success) {
                outcomes["completed"]++;
                updateUploadFeedback(`${outcomes.completed} of ${numFiles} completed...`);
            } else {
                outcomes["failed"]++;
            }
        });

        // Also upload a thumbnail image for videos
        if(files[i].type.split('/')[0] === 'video') {
            captureVideoThumbnail(files[i]).then((blob) => {
                queueFileUpload(blob, `video_thumbnails/${targetFilename}`, uploaderName);
            }).catch(error => {
                console.warn('Video thumbnail creation failed.', error);
                return false;
            });
        }
    }

    // User cancellation of fetches
    cancelUploadElement.onclick = cancelUpload(controllers);

    // When all fetches are done...
    Promise.all(fetches).then(() => {
        if(outcomes.completed > 0) {
            setTimeout(() => {
                renderPhotoThumbnails(outcomes.completed, "", true);
            }, 4000);
        }
    })
    
    .catch((error) => {
        console.error(error);
    })
    
    .finally(() => {
        // Prevents flashing and ensures modal actually shows on Safari
        setTimeout(() => {
            hideUploadFeedback();
            toastMessage( getUploadCompleteMessage(outcomes) );
        }, 1500);

        imageFilesElement.value = '';
    });
}

function queueFileUpload(file, targetFilename, uploaderName = '') {
    targetFilename = encodeURIComponent(targetFilename);
    const encodedUploaderName = encodeURIComponent(uploaderName);
    
    let controller = new AbortController();

    let upload = fetch(`/api/photos?targetFilename=${targetFilename}&uploaderName=${encodedUploaderName}`, {
        method: 'POST',
        body: file,
        headers: {
            "Content-Type": file.type
        },
        signal: controller.signal
    })
    
    .then((response) => {
        if(Math.floor(response.status/100) === 2) {
            return true;
        } else {
            throw new Error(`Upload of file ${targetFilename} to blob storage failed`);
        }
    })
    
    .catch((error) => {
        if(error.name != 'AbortError') {
            console.error(error);
        }
        return false;
    });

    return { 
        upload,
        controller
    }
}

function cancelUpload(controllers) {
    return (event) => {
        event.preventDefault();
        uploadMessageElement.textContent = 'Cancelling...';
        controllers.forEach(controller => controller.abort());
    }
}

function getUploadCompleteMessage(outcomes) {
        let uploadCompleteMessage = '';

        // Update message
        uploadCompleteMessage += (outcomes.completed > 0) ? 
            `✅ ${outcomes.completed} files uploaded successfully. ` : '';

        uploadCompleteMessage += (outcomes.failed > 0) ? 
            `❌ ${outcomes.failed} files failed, please try again.` : '';

        return uploadCompleteMessage;
}

function updateUploadFeedback(message = '') {
    uploadMessageElement.textContent = message;
}

function showUploadFeedback() {
    document.body.classList.add('locked');
    uploadFeedbackElement.classList.remove('hidden');
}

function hideUploadFeedback() {
    document.body.classList.remove('locked');
    uploadFeedbackElement.classList.add('hidden');
}

function toastMessage(message) {
    toastElement.querySelector('.message').innerHTML = message;

    toastElement.classList.add('active');

    setTimeout(() => {
        toastElement.classList.remove('active');
    }, 3000);
}

function getLightboxUrl(file) {
    let { url, transcodedUrl, contentType } = file;

    if(transcodedUrl) return transcodedUrl;

    if(contentType.split('/')[0] === 'image') {
        // Only append optimization parameters if using a CDN
        const isS3 = url.includes('your-objectstorage.com');
        if (!isS3) {
            url += '?q=65&h=1080';
        }
    }

    return url
}

function refreshLightbox() {
    if(window.refreshFsLightbox) {
        refreshFsLightbox();
        fsLightbox.props.loadOnlyCurrentSource = true;
        fsLightbox.props.onSlideChange = () => {
            console.log(document.querySelectorAll('video'));
        }
    }
}

function captureVideoThumbnail(file) {
    return new Promise((resolve, reject) => {

        const seekTo = 0.001;
        
        const tempVideo = document.createElement('video');
        tempVideo.setAttribute('src', URL.createObjectURL(file));
        tempVideo.load();

        // Seek to first frame on load
        tempVideo.addEventListener('loadedmetadata', () => {
            if (tempVideo.duration < seekTo) {
                reject("Video contains no frames.");
                return;
            }

            // Delay seeking or else 'seeked' event won't fire on Safari
            setTimeout(() => {
              tempVideo.currentTime = seekTo;
            }, 200);
        });

        // Extract thumbnail on seek
        tempVideo.addEventListener('seeked', () => {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = tempVideo.videoWidth;
            tempCanvas.height = tempVideo.videoHeight;
            
            const ctx = tempCanvas.getContext("2d");
            ctx.drawImage(tempVideo, 0, 0, tempCanvas.width, tempCanvas.height);
            
            ctx.canvas.toBlob(
                blob => resolve(blob),
                "image/jpeg",
                0.6 // Quality
            );
        });
    });
}

/* Event handlers */
document.addEventListener('DOMContentLoaded', () => {
    renderPhotoThumbnails();
});

document.addEventListener('scroll', loadMoreOnScroll);

var throttleTimer;

function throttle(callback, time) {
    if(throttleTimer) return;
    
    throttleTimer = setTimeout(() => {
        callback();
        throttleTimer = false;
    }, time);
};

if(uploadBtnElement) {
    uploadBtnElement.addEventListener('click', (event) => {
        event.preventDefault();
        imageFilesElement.click();
    });
}

if(imageFilesElement) {
    imageFilesElement.onchange = (event) => {
        uploadFiles(event);
    }
}

if(refreshLinkElement) {
    refreshLinkElement.onclick = (event) => {
        event.preventDefault();
        refreshLinkElement.classList.add('hidden');
        refreshPhotoThumbnails();
    }
}

const uploaderFilterElement = document.getElementById('uploaderFilter');
if (uploaderFilterElement) {
    uploaderFilterElement.addEventListener('change', () => {
        refreshPhotoThumbnails();
    });
}
