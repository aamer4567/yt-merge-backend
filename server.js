const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const TEMP_DIR = "/tmp/vidssave";

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}

const jobs = new Map();

/*
=========================================================
YT-DLP
=========================================================
*/

const YTDLP_COMMAND =
    process.env.YTDLP_PATH || "yt-dlp";


/*
=========================================================
ROOT
=========================================================
*/

app.get("/", (req, res) => {

    res.json({
        service: "VidsSave Media Processing API",
        status: "running",
        version: "5.0.0",
        rapidAPI: false
    });

});


/*
=========================================================
HEALTH
=========================================================
*/

app.get("/health", async (req, res) => {

    const ytDlpAvailable =
        await checkYtDlp();

    res.json({
        status: "ok",
        ffmpeg: true,
        ytDlp: ytDlpAvailable,
        rapidAPI: false,
        uptime: Math.floor(process.uptime())
    });

});


/*
=========================================================
VIDEO INFORMATION
=========================================================
*/

app.get("/video", async (req, res) => {

    try {

        const videoId =
            String(req.query.videoId || "").trim();


        if (!videoId) {

            return res.status(400).json({
                error: "videoId required hai."
            });

        }


        if (!isValidVideoId(videoId)) {

            return res.status(400).json({
                error: "Invalid YouTube video ID."
            });

        }


        const ytDlpAvailable =
            await checkYtDlp();


        if (!ytDlpAvailable) {

            return res.status(500).json({

                error:
                    "yt-dlp server par available nahi hai.",

                hint:
                    "Render Build Command mein yt-dlp install karo."

            });

        }


        const youtubeUrl =
            `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;


        console.log(
            `Fetching video information: ${videoId}`
        );


        const info =
            await getVideoInfo(
                youtubeUrl
            );


        const result =
            formatVideoResponse(
                info,
                videoId
            );


        res.json(result);


    } catch (error) {

        console.error(
            "Video information error:",
            error
        );


        res.status(500).json({

            error:
                "Video information fetch nahi ho saki.",

            details:
                safeErrorMessage(error)

        });

    }

});


/*
=========================================================
DIRECT FORMAT DOWNLOAD
=========================================================
*/

app.get("/download", async (req, res) => {

    try {

        const videoId =
            String(req.query.videoId || "").trim();

        const formatId =
            String(req.query.formatId || "").trim();


        if (!videoId) {

            return res.status(400).send(
                "videoId required hai."
            );

        }


        if (!isValidVideoId(videoId)) {

            return res.status(400).send(
                "Invalid video ID."
            );

        }


        if (!formatId) {

            return res.status(400).send(
                "formatId required hai."
            );

        }


        const youtubeUrl =
            `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;


        console.log(
            `Download requested: ${videoId} format=${formatId}`
        );


        const info =
            await getVideoInfo(
                youtubeUrl
            );


        const selected =
            findFormat(
                info,
                formatId
            );


        if (!selected) {

            return res.status(404).send(
                "Requested format available nahi hai."
            );

        }


        const title =
            cleanFilename(
                info.title || "video"
            );


        /*
         * IMPORTANT:
         * We let yt-dlp perform the actual media download.
         * The browser never receives a temporary googlevideo URL.
         */


        const outputTemplate =
            path.join(
                TEMP_DIR,
                `${crypto.randomUUID()}-%(title)s.%(ext)s`
            );


        const args = [

            "--no-playlist",

            "--no-warnings",

            "--newline",

            "-f",
            String(formatId),

            "-o",
            outputTemplate,

            youtubeUrl

        ];


        const child =
            spawn(
                YTDLP_COMMAND,
                args,
                {
                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]
                }
            );


        let stdout = "";
        let stderr = "";


        child.stdout.on(
            "data",
            chunk => {

                stdout +=
                    chunk.toString();

            }
        );


        child.stderr.on(
            "data",
            chunk => {

                stderr +=
                    chunk.toString();

                console.log(
                    `[yt-dlp] ${chunk.toString().trim()}`
                );

            }
        );


        child.on(
            "error",
            error => {

                console.error(
                    "yt-dlp spawn error:",
                    error
                );


                if (!res.headersSent) {

                    res.status(500).send(
                        "yt-dlp start nahi ho saka."
                    );

                }

            }
        );


        child.on(
            "close",
            code => {

                if (code !== 0) {

                    console.error(
                        "yt-dlp failed:",
                        stderr
                    );


                    if (!res.headersSent) {

                        res.status(500).send(
                            getYtDlpError(
                                stderr
                            )
                        );

                    }

                    return;

                }


                /*
                 * Find the newest file created by this request.
                 */

                const outputFile =
                    findNewestMatchingFile(
                        TEMP_DIR,
                        path.basename(
                            outputTemplate
                        ).split("-")[0]
                    );


                if (!outputFile) {

                    if (!res.headersSent) {

                        res.status(500).send(
                            "Downloaded file server par nahi mili."
                        );

                    }

                    return;

                }


                const extension =
                    path.extname(
                        outputFile
                    ) || ".mp4";


                const filename =
                    `${title}${extension}`;


                res.download(
                    outputFile,
                    filename,
                    error => {

                        try {

                            if (
                                fs.existsSync(
                                    outputFile
                                )
                            ) {

                                fs.unlinkSync(
                                    outputFile
                                );

                            }

                        } catch (cleanupError) {

                            console.error(
                                "Download cleanup error:",
                                cleanupError
                            );

                        }


                        if (error) {

                            console.error(
                                "Download response error:",
                                error
                            );

                        }

                    }
                );

            }
        );


    } catch (error) {

        console.error(
            "Direct download error:",
            error
        );


        if (!res.headersSent) {

            res.status(500).send(
                safeErrorMessage(error)
            );

        }

    }

});


/*
=========================================================
CREATE MERGE JOB
=========================================================
*/

app.get("/merge", async (req, res) => {

    try {

        const {
            videoUrl,
            audioUrl,
            title
        } = req.query;


        if (!videoUrl || !audioUrl) {

            return res.status(400).json({
                error:
                    "videoUrl aur audioUrl dono required hain."
            });

        }


        if (!isHttpUrl(videoUrl)) {

            return res.status(400).json({
                error:
                    "Invalid video URL."
            });

        }


        if (!isHttpUrl(audioUrl)) {

            return res.status(400).json({
                error:
                    "Invalid audio URL."
            });

        }


        const jobId =
            crypto.randomUUID();


        const outputFile =
            path.join(
                TEMP_DIR,
                `${jobId}.mp4`
            );


        const safeTitle =
            cleanFilename(
                title || "video"
            );


        jobs.set(jobId, {

            id: jobId,

            type: "merge",

            status: "processing",

            progress: 0,

            stage:
                "Video + Audio processing start ho rahi hai...",

            outputFile,

            title: safeTitle,

            error: null,

            createdAt: Date.now()

        });


        console.log(
            `Merge job started: ${jobId}`
        );


        runMergeJob(
            jobId,
            videoUrl,
            audioUrl,
            outputFile
        );


        res.json({

            success: true,

            jobId

        });


    } catch (error) {

        console.error(
            "Merge creation error:",
            error
        );


        res.status(500).json({

            error:
                "Merge job create nahi ho saka.",

            details:
                safeErrorMessage(error)

        });

    }

});


/*
=========================================================
CREATE MP3 JOB
=========================================================
*/

app.get("/mp3", async (req, res) => {

    try {

        const {
            audioUrl,
            title
        } = req.query;


        if (!audioUrl) {

            return res.status(400).json({
                error:
                    "audioUrl required hai."
            });

        }


        if (!isHttpUrl(audioUrl)) {

            return res.status(400).json({
                error:
                    "Invalid audio URL."
            });

        }


        const jobId =
            crypto.randomUUID();


        const outputFile =
            path.join(
                TEMP_DIR,
                `${jobId}.mp3`
            );


        const safeTitle =
            cleanFilename(
                title || "audio"
            );


        jobs.set(jobId, {

            id: jobId,

            type: "mp3",

            status: "processing",

            progress: 0,

            stage:
                "MP3 conversion start ho rahi hai...",

            outputFile,

            title: safeTitle,

            error: null,

            createdAt: Date.now()

        });


        console.log(
            `MP3 job started: ${jobId}`
        );


        runMp3Job(
            jobId,
            audioUrl,
            outputFile
        );


        res.json({

            success: true,

            jobId

        });


    } catch (error) {

        console.error(
            "MP3 creation error:",
            error
        );


        res.status(500).json({

            error:
                "MP3 job create nahi hui.",

            details:
                safeErrorMessage(error)

        });

    }

});


/*
=========================================================
JOB STATUS
=========================================================
*/

app.get("/merge-status/:jobId", (req, res) => {

    const job =
        jobs.get(
            req.params.jobId
        );


    if (!job) {

        return res.status(404).json({

            error:
                "Job nahi mili."

        });

    }


    res.json({

        success: true,

        jobId: job.id,

        type: job.type,

        status: job.status,

        progress:
            Math.round(
                job.progress || 0
            ),

        stage:
            job.stage,

        error:
            job.error

    });

});


/*
=========================================================
VIDEO DOWNLOAD
=========================================================
*/

app.get("/merge-download/:jobId", (req, res) => {

    const job =
        jobs.get(
            req.params.jobId
        );


    if (!job) {

        return res.status(404).send(
            "Merge job nahi mila."
        );

    }


    if (job.type !== "merge") {

        return res.status(400).send(
            "Invalid job type."
        );

    }


    if (job.status !== "completed") {

        return res.status(409).send(
            "Video abhi ready nahi hai."
        );

    }


    if (
        !job.outputFile ||
        !fs.existsSync(job.outputFile)
    ) {

        return res.status(404).send(
            "Processed video file nahi mili."
        );

    }


    const filename =
        `${job.title || "video"}.mp4`;


    res.download(
        job.outputFile,
        filename,
        error => {

            if (error) {

                console.error(
                    "Video download error:",
                    error
                );

            }


            cleanupJob(
                job.id
            );

        }
    );

});


/*
=========================================================
MP3 DOWNLOAD
=========================================================
*/

app.get("/mp3-download/:jobId", (req, res) => {

    const job =
        jobs.get(
            req.params.jobId
        );


    if (!job) {

        return res.status(404).send(
            "MP3 job nahi mila."
        );

    }


    if (job.type !== "mp3") {

        return res.status(400).send(
            "Invalid job type."
        );

    }


    if (job.status !== "completed") {

        return res.status(409).send(
            "MP3 abhi ready nahi hai."
        );

    }


    if (
        !job.outputFile ||
        !fs.existsSync(job.outputFile)
    ) {

        return res.status(404).send(
            "MP3 file nahi mili."
        );

    }


    const filename =
        `${job.title || "audio"}.mp3`;


    res.download(
        job.outputFile,
        filename,
        error => {

            if (error) {

                console.error(
                    "MP3 download error:",
                    error
                );

            }


            cleanupJob(
                job.id
            );

        }
    );

});


/*
=========================================================
MERGE PROCESS
=========================================================
*/

function runMergeJob(
    jobId,
    videoUrl,
    audioUrl,
    outputFile
) {

    const job =
        jobs.get(jobId);


    if (!job) {
        return;
    }


    const command =
        ffmpeg();


    command
        .input(videoUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ]);


    command
        .input(audioUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ]);


    command
        .outputOptions([

            "-map 0:v:0",

            "-map 1:a:0",

            "-c:v libx264",

            "-preset veryfast",

            "-crf 23",

            "-c:a aac",

            "-b:a 192k",

            "-pix_fmt yuv420p",

            "-shortest",

            "-movflags +faststart"

        ])

        .format("mp4")

        .on("start", commandLine => {

            console.log(
                `FFmpeg merge started: ${jobId}`
            );

            console.log(
                commandLine
            );

        })

        .on("progress", progress => {

            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            if (
                typeof progress.percent ===
                "number"
            ) {

                currentJob.progress =
                    Math.min(
                        99,
                        Math.max(
                            0,
                            Math.round(
                                progress.percent
                            )
                        )
                    );

            }


            currentJob.stage =
                "Video + Audio merge ho raha hai...";

        })

        .on("error", error => {

            console.error(
                `FFmpeg merge error ${jobId}:`,
                error
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            currentJob.status =
                "error";


            currentJob.progress =
                0;


            currentJob.stage =
                "Processing failed.";


            currentJob.error =
                getSafeFfmpegError(
                    error
                );

        })

        .on("end", () => {

            console.log(
                `Merge completed: ${jobId}`
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            if (
                !fs.existsSync(
                    outputFile
                )
            ) {

                currentJob.status =
                    "error";

                currentJob.stage =
                    "Output file missing.";

                currentJob.error =
                    "FFmpeg completed but output file was not created.";

                return;

            }


            currentJob.status =
                "completed";


            currentJob.progress =
                100;


            currentJob.stage =
                "Video ready hai.";

        })

        .save(outputFile);

}


/*
=========================================================
MP3 PROCESS
=========================================================
*/

function runMp3Job(
    jobId,
    audioUrl,
    outputFile
) {

    const job =
        jobs.get(jobId);


    if (!job) {
        return;
    }


    ffmpeg()

        .input(audioUrl)

        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ])

        .outputOptions([

            "-vn",

            "-c:a libmp3lame",

            "-b:a 192k"

        ])

        .format("mp3")

        .on("start", commandLine => {

            console.log(
                `FFmpeg MP3 started: ${jobId}`
            );

            console.log(
                commandLine
            );

        })

        .on("progress", progress => {

            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            if (
                typeof progress.percent ===
                "number"
            ) {

                currentJob.progress =
                    Math.min(
                        99,
                        Math.max(
                            0,
                            Math.round(
                                progress.percent
                            )
                        )
                    );

            }


            currentJob.stage =
                "MP3 conversion ho rahi hai...";

        })

        .on("error", error => {

            console.error(
                `FFmpeg MP3 error ${jobId}:`,
                error
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            currentJob.status =
                "error";


            currentJob.progress =
                0;


            currentJob.stage =
                "MP3 conversion failed.";


            currentJob.error =
                getSafeFfmpegError(
                    error
                );

        })

        .on("end", () => {

            console.log(
                `MP3 completed: ${jobId}`
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            if (
                !fs.existsSync(
                    outputFile
                )
            ) {

                currentJob.status =
                    "error";

                currentJob.stage =
                    "Output file missing.";

                currentJob.error =
                    "FFmpeg completed but output file was not created.";

                return;

            }


            currentJob.status =
                "completed";


            currentJob.progress =
                100;


            currentJob.stage =
                "MP3 ready hai.";

        })

        .save(outputFile);

}


/*
=========================================================
YOUTUBE INFO
=========================================================
*/

function getVideoInfo(url) {

    return new Promise(
        (resolve, reject) => {

            const args = [

                "--dump-single-json",

                "--no-playlist",

                "--no-warnings",

                "--skip-download",

                url

            ];


            const child =
                spawn(
                    YTDLP_COMMAND,
                    args,
                    {
                        stdio: [
                            "ignore",
                            "pipe",
                            "pipe"
                        ]
                    }
                );


            let stdout = "";
            let stderr = "";


            child.stdout.on(
                "data",
                chunk => {

                    stdout +=
                        chunk.toString();

                }
            );


            child.stderr.on(
                "data",
                chunk => {

                    stderr +=
                        chunk.toString();

                }
            );


            child.on(
                "error",
                error => {

                    reject(error);

                }
            );


            child.on(
                "close",
                code => {

                    if (code !== 0) {

                        reject(
                            new Error(
                                getYtDlpError(
                                    stderr
                                )
                            )
                        );

                        return;

                    }


                    try {

                        const data =
                            JSON.parse(
                                stdout
                            );


                        resolve(data);

                    } catch (error) {

                        reject(
                            new Error(
                                "yt-dlp ne valid JSON return nahi kiya."
                            )
                        );

                    }

                }
            );

        }
    );

}


/*
=========================================================
FORMAT RESPONSE
=========================================================
*/

function formatVideoResponse(
    info,
    videoId
) {

    const formats =
        Array.isArray(info.formats)
            ? info.formats
            : [];


    const videos = [];
    const audios = [];


    const wantedQualities = [
        "1080p",
        "720p",
        "480p",
        "360p",
        "240p",
        "144p"
    ];


    for (
        const format
        of formats
    ) {

        if (
            !format ||
            !format.format_id
        ) {
            continue;
        }


        const height =
            Number(
                format.height || 0
            );


        const ext =
            format.ext || "";


        const hasVideo =
            Boolean(
                format.vcodec &&
                format.vcodec !== "none"
            );


        const hasAudio =
            Boolean(
                format.acodec &&
                format.acodec !== "none"
            );


        if (
            !hasVideo &&
            !hasAudio
        ) {
            continue;
        }


        if (hasVideo) {

            let quality = "";


            if (height > 0) {

                quality =
                    `${height}p`;

            }


            if (
                !wantedQualities.includes(
                    quality
                )
            ) {
                continue;
            }


            /*
             * Backend URL instead of temporary googlevideo URL.
             */

            videos.push({

                url:
                    buildDownloadUrl(
                        videoId,
                        format.format_id
                    ),

                formatId:
                    String(
                        format.format_id
                    ),

                quality,

                width:
                    Number(
                        format.width || 0
                    ),

                height,

                extension: ext,

                mimeType:
                    format.mime_type ||
                    null,

                size:
                    Number(
                        format.filesize ||
                        format.filesize_approx ||
                        0
                    ),

                sizeText:
                    format.filesize
                        ? formatBytes(
                            format.filesize
                        )
                        : null,

                hasAudio,

                fps:
                    Number(
                        format.fps || 0
                    ),

                vcodec:
                    format.vcodec ||
                    null,

                acodec:
                    format.acodec ||
                    null

            });

        }


        if (
            hasAudio &&
            !hasVideo
        ) {

            audios.push({

                url:
                    buildDownloadUrl(
                        videoId,
                        format.format_id
                    ),

                formatId:
                    String(
                        format.format_id
                    ),

                extension: ext,

                mimeType:
                    format.mime_type ||
                    null,

                bitrate:
                    Number(
                        format.abr ||
                        format.tbr ||
                        0
                    ),

                size:
                    Number(
                        format.filesize ||
                        format.filesize_approx ||
                        0
                    ),

                sizeText:
                    format.filesize
                        ? formatBytes(
                            format.filesize
                        )
                        : null,

                acodec:
                    format.acodec ||
                    null

            });

        }

    }


    /*
     * Prefer formats with audio when duplicate qualities exist.
     */

    videos.sort(
        (a, b) => {

            if (
                a.height !==
                b.height
            ) {

                return (
                    b.height -
                    a.height
                );

            }


            if (
                a.hasAudio !==
                b.hasAudio
            ) {

                return a.hasAudio
                    ? -1
                    : 1;

            }


            return 0;

        }
    );


    /*
     * Remove duplicate qualities.
     */

    const uniqueVideos =
        [];


    const seenQualities =
        new Set();


    for (
        const video
        of videos
    ) {

        if (
            seenQualities.has(
                video.quality
            )
        ) {
            continue;
        }


        seenQualities.add(
            video.quality
        );


        uniqueVideos.push(
            video
        );

    }


    /*
     * Sort audio by bitrate.
     */

    audios.sort(
        (a, b) =>
            (b.bitrate || 0) -
            (a.bitrate || 0)
    );


    return {

        errorId:
            "Success",

        type:
            "video",

        id:
            videoId,

        title:
            info.title ||
            "YouTube Video",

        description:
            info.description ||
            "",

        lengthSeconds:
            Number(
                info.duration || 0
            ),

        viewCount:
            Number(
                info.view_count || 0
            ),

        likeCount:
            Number(
                info.like_count || 0
            ),

        publishedTime:
            info.upload_date
                ? convertUploadDate(
                    info.upload_date
                )
                : null,

        thumbnails:
            Array.isArray(
                info.thumbnails
            )
                ? info.thumbnails.map(
                    item => ({
                        url:
                            item.url,
                        width:
                            Number(
                                item.width || 0
                            ),
                        height:
                            Number(
                                item.height || 0
                            )
                    })
                )
                : [],

        channel: {

            name:
                info.channel ||
                info.uploader ||
                "",

            id:
                info.channel_id ||
                null,

            handle:
                info.uploader_id
                    ? `@${String(
                        info.uploader_id
                    ).replace(/^@/, "")}`
                    : null

        },

        videos: {

            errorId:
                "Success",

            items:
                uniqueVideos

        },

        audios: {

            errorId:
                "Success",

            items:
                audios

        }

    };

}


/*
=========================================================
BUILD BACKEND DOWNLOAD URL
=========================================================
*/

function buildDownloadUrl(
    videoId,
    formatId
) {

    return (
        `/download?videoId=${encodeURIComponent(videoId)}` +
        `&formatId=${encodeURIComponent(formatId)}`
    );

}


/*
=========================================================
FIND FORMAT
=========================================================
*/

function findFormat(
    info,
    formatId
) {

    if (
        !info ||
        !Array.isArray(info.formats)
    ) {

        return null;

    }


    return (
        info.formats.find(
            format =>
                String(
                    format.format_id
                ) ===
                String(formatId)
        ) ||
        null
    );

}


/*
=========================================================
CHECK YT-DLP
=========================================================
*/

function checkYtDlp() {

    return new Promise(
        resolve => {

            const child =
                spawn(
                    YTDLP_COMMAND,
                    [
                        "--version"
                    ],
                    {
                        stdio: [
                            "ignore",
                            "pipe",
                            "ignore"
                        ]
                    }
                );


            child.on(
                "error",
                () => {

                    resolve(false);

                }
            );


            child.on(
                "close",
                code => {

                    resolve(
                        code === 0
                    );

                }
            );

        }
    );

}


/*
=========================================================
VIDEO ID VALIDATION
=========================================================
*/

function isValidVideoId(
    value
) {

    return /^[A-Za-z0-9_-]{11}$/.test(
        value
    );

}


/*
=========================================================
HTTP URL VALIDATION
=========================================================
*/

function isHttpUrl(
    value
) {

    try {

        const url =
            new URL(
                String(value)
            );


        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch {

        return false;

    }

}


/*
=========================================================
FILENAME CLEANER
=========================================================
*/

function cleanFilename(
    name
) {

    return String(name)

        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        )

        .replace(
            /\s+/g,
            "_"
        )

        .replace(
            /_+/g,
            "_"
        )

        .replace(
            /^\.+/,
            ""
        )

        .substring(
            0,
            150
        )

        || "download";

}


/*
=========================================================
DATE
=========================================================
*/

function convertUploadDate(
    value
) {

    if (
        !/^\d{8}$/.test(
            String(value)
        )
    ) {

        return null;

    }


    const year =
        value.substring(
            0,
            4
        );

    const month =
        value.substring(
            4,
            6
        );

    const day =
        value.substring(
            6,
            8
        );


    return `${year}-${month}-${day}T00:00:00Z`;

}


/*
=========================================================
BYTES
=========================================================
*/

function formatBytes(
    bytes
) {

    const value =
        Number(bytes);


    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        return null;

    }


    const units = [
        "B",
        "KB",
        "MB",
        "GB"
    ];


    const index =
        Math.min(
            Math.floor(
                Math.log(value) /
                Math.log(1024)
            ),
            units.length - 1
        );


    return (
        `${(
            value /
            Math.pow(
                1024,
                index
            )
        ).toFixed(1)}${units[index]}`
    );

}


/*
=========================================================
NEWEST FILE
=========================================================
*/

function findNewestMatchingFile(
    directory,
    prefix
) {

    let files;


    try {

        files =
            fs.readdirSync(
                directory
            );

    } catch {

        return null;

    }


    const matches =
        files
            .filter(
                file =>
                    file.startsWith(
                        prefix
                    )
            )
            .map(
                file => {

                    const fullPath =
                        path.join(
                            directory,
                            file
                        );

                    let stat;


                    try {

                        stat =
                            fs.statSync(
                                fullPath
                            );

                    } catch {

                        return null;

                    }


                    return {

                        file: fullPath,

                        mtime:
                            stat.mtimeMs

                    };

                }
            )
            .filter(Boolean)
            .sort(
                (a, b) =>
                    b.mtime -
                    a.mtime
            );


    return matches.length
        ? matches[0].file
        : null;

}


/*
=========================================================
YT-DLP ERROR
=========================================================
*/

function getYtDlpError(
    stderr
) {

    const message =
        String(
            stderr || ""
        ).trim();


    if (
        message.toLowerCase()
            .includes(
                "sign in"
            )
    ) {

        return (
            "YouTube ne is video ke liye sign-in/access restriction lagayi hai."
        );

    }


    if (
        message.toLowerCase()
            .includes(
                "private video"
            )
    ) {

        return (
            "Ye private video hai."
        );

    }


    if (
        message.toLowerCase()
            .includes(
                "video unavailable"
            )
    ) {

        return (
            "Video unavailable hai."
        );

    }


    if (
        message.toLowerCase()
            .includes(
                "requested format"
            )
    ) {

        return (
            "Requested format available nahi hai."
        );

    }


    return (
        message.substring(
            0,
            1200
        ) ||
        "yt-dlp request failed."
    );

}


/*
=========================================================
FFMPEG ERROR
=========================================================
*/

function getSafeFfmpegError(
    error
) {

    if (!error) {

        return "FFmpeg processing failed.";

    }


    const message =
        String(
            error.message ||
            error
        );


    if (
        message.includes(
            "403 Forbidden"
        )
    ) {

        return (
            "Source media server ne access deny kiya."
        );

    }


    if (
        message.includes(
            "404 Not Found"
        )
    ) {

        return (
            "Source media file nahi mili."
        );

    }


    if (
        message.includes(
            "Invalid data found"
        )
    ) {

        return (
            "Source media format valid nahi hai."
        );

    }


    return message.substring(
        0,
        1000
    );

}


/*
=========================================================
SAFE ERROR
=========================================================
*/

function safeErrorMessage(
    error
) {

    if (!error) {

        return "Unknown server error.";

    }


    return String(
        error.message ||
        error
    ).substring(
        0,
        1200
    );

}


/*
=========================================================
JOB CLEANUP
=========================================================
*/

function cleanupJob(
    jobId
) {

    const job =
        jobs.get(jobId);


    if (!job) {
        return;
    }


    try {

        if (
            job.outputFile &&
            fs.existsSync(
                job.outputFile
            )
        ) {

            fs.unlinkSync(
                job.outputFile
            );

        }

    } catch (error) {

        console.error(
            "File cleanup error:",
            error
        );

    }


    jobs.delete(
        jobId
    );

}


/*
=========================================================
OLD JOB CLEANUP
=========================================================
*/

setInterval(
    () => {

        const now =
            Date.now();


        for (
            const [id, job]
            of jobs.entries()
        ) {

            const age =
                now -
                job.createdAt;


            if (
                age >
                30 * 60 * 1000
            ) {

                cleanupJob(
                    id
                );

            }

        }

    },
    5 * 60 * 1000
);


/*
=========================================================
GLOBAL ERROR
=========================================================
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled server error:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(
                error
            );

        }


        res.status(500).json({

            error:
                "Internal server error."

        });

    }
);


/*
=========================================================
SERVER
=========================================================
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `VidsSave Media API running on port ${PORT}`
        );

        console.log(
            `yt-dlp command: ${YTDLP_COMMAND}`
        );

    }
);
