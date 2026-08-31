const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const TEMP_DIR = "/tmp/vidssave";
const UPLOAD_DIR = path.join(TEMP_DIR, "uploads");

const MAX_FILE_SIZE = 500 * 1024 * 1024;

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const jobs = new Map();
const mediaFiles = new Map();


/*
=========================================================
MULTER
=========================================================
*/

const upload = multer({

    storage: multer.diskStorage({

        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },

        filename: (req, file, cb) => {

            const ext =
                path.extname(file.originalname)
                    .toLowerCase();

            cb(
                null,
                `${crypto.randomUUID()}${ext}`
            );

        }

    }),

    limits: {
        fileSize: MAX_FILE_SIZE
    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            ".mp4",
            ".mkv",
            ".webm",
            ".mov",
            ".m4v",
            ".avi",
            ".mp3",
            ".m4a",
            ".wav",
            ".aac",
            ".flac"
        ];

        const ext =
            path.extname(file.originalname)
                .toLowerCase();

        if (!allowed.includes(ext)) {

            return cb(
                new Error(
                    "Unsupported media format."
                )
            );

        }

        cb(null, true);

    }

});


/*
=========================================================
ROOT
=========================================================
*/

app.get("/", (req, res) => {

    res.json({

        service:
            "VidsSave Media Processing API",

        status:
            "running",

        version:
            "7.0.0",

        rapidAPI:
            false,

        upload:
            true

    });

});


/*
=========================================================
HEALTH
=========================================================
*/

app.get("/health", (req, res) => {

    res.json({

        status:
            "ok",

        ffmpeg:
            true,

        rapidAPI:
            false,

        upload:
            true,

        maxUploadMB:
            MAX_FILE_SIZE / 1024 / 1024,

        uptime:
            Math.floor(
                process.uptime()
            )

    });

});


/*
=========================================================
UPLOAD
=========================================================
*/

app.post(
    "/media/upload",
    upload.single("media"),
    (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    error:
                        "Media file select nahi ki gayi."

                });

            }


            const mediaId =
                crypto.randomUUID();


            const originalName =
                req.file.originalname;


            const extension =
                path.extname(
                    originalName
                ).toLowerCase();


            const isAudio =
                [
                    ".mp3",
                    ".m4a",
                    ".wav",
                    ".aac",
                    ".flac"
                ].includes(
                    extension
                );


            mediaFiles.set(
                mediaId,
                {

                    id:
                        mediaId,

                    inputFile:
                        req.file.path,

                    originalName,

                    type:
                        isAudio
                            ? "audio"
                            : "video",

                    size:
                        req.file.size,

                    createdAt:
                        Date.now()

                }
            );


            console.log(
                `Upload complete: ${mediaId}`
            );


            return res.status(201).json({

                success:
                    true,

                mediaId,

                filename:
                    originalName,

                type:
                    isAudio
                        ? "audio"
                        : "video",

                size:
                    req.file.size

            });


        } catch (error) {

            console.error(
                "Upload error:",
                error
            );


            if (
                req.file?.path &&
                fs.existsSync(
                    req.file.path
                )
            ) {

                try {

                    fs.unlinkSync(
                        req.file.path
                    );

                } catch {}

            }


            return res.status(500).json({

                error:
                    "Upload failed.",

                details:
                    safeError(error)

            });

        }

    }
);


/*
=========================================================
PROCESS UPLOADED FILE
=========================================================
*/

app.post(
    "/media/process-upload",
    (req, res) => {

        try {

            const {
                mediaId,
                output
            } =
                req.body || {};


            if (!mediaId) {

                return res.status(400).json({

                    error:
                        "mediaId required hai."

                });

            }


            const media =
                mediaFiles.get(
                    mediaId
                );


            if (!media) {

                return res.status(404).json({

                    error:
                        "Uploaded media nahi mili."

                });

            }


            if (
                !fs.existsSync(
                    media.inputFile
                )
            ) {

                mediaFiles.delete(
                    mediaId
                );


                return res.status(404).json({

                    error:
                        "Uploaded file server par nahi mili."

                });

            }


            const requestedOutput =
                String(
                    output || "mp4"
                ).toLowerCase();


            if (
                requestedOutput !== "mp4" &&
                requestedOutput !== "mp3"
            ) {

                return res.status(400).json({

                    error:
                        "Output sirf mp4 ya mp3 ho sakta hai."

                });

            }


            if (
                media.type === "audio" &&
                requestedOutput === "mp4"
            ) {

                return res.status(400).json({

                    error:
                        "Audio file ko MP4 video mein convert nahi kiya ja sakta."

                });

            }


            /*
            =============================================
            NEW JOB ID
            =============================================
            */

            const jobId =
                crypto.randomUUID();


            const extension =
                requestedOutput === "mp3"
                    ? ".mp3"
                    : ".mp4";


            const outputFile =
                path.join(
                    TEMP_DIR,
                    `${jobId}${extension}`
                );


            const safeTitle =
                cleanFilename(
                    path.basename(
                        media.originalName,
                        path.extname(
                            media.originalName
                        )
                    )
                );


            const job = {

                id:
                    jobId,

                mediaId,

                type:
                    requestedOutput,

                status:
                    "processing",

                progress:
                    0,

                stage:
                    requestedOutput === "mp3"
                        ? "MP3 conversion start ho rahi hai..."
                        : "MP4 conversion start ho rahi hai...",

                inputFile:
                    media.inputFile,

                outputFile,

                title:
                    safeTitle,

                error:
                    null,

                createdAt:
                    Date.now(),

                finishedAt:
                    null

            };


            jobs.set(
                jobId,
                job
            );


            console.log(
                `Processing job created: ${jobId}`
            );


            /*
            =============================================
            Start asynchronously
            =============================================
            */

            runMediaJob(
                jobId
            );


            /*
            =============================================
            IMPORTANT:
            Job ID frontend ko return karo.
            =============================================
            */

            return res.status(202).json({

                success:
                    true,

                jobId,

                mediaId,

                output:
                    requestedOutput

            });


        } catch (error) {

            console.error(
                "Process upload error:",
                error
            );


            return res.status(500).json({

                error:
                    "Processing start nahi ho saki.",

                details:
                    safeError(error)

            });

        }

    }
);


/*
=========================================================
JOB STATUS
=========================================================
*/

app.get(
    "/jobs/:jobId",
    getJobStatus
);


/*
=========================================================
BACKWARD-COMPATIBILITY STATUS
=========================================================
*/

app.get(
    "/merge-status/:jobId",
    getJobStatus
);


function getJobStatus(
    req,
    res
) {

    const job =
        jobs.get(
            req.params.jobId
        );


    if (!job) {

        return res.status(404).json({

            error:
                "Job nahi mili.",

            jobId:
                req.params.jobId

        });

    }


    return res.json({

        success:
            true,

        jobId:
            job.id,

        type:
            job.type,

        status:
            job.status,

        progress:
            Math.round(
                clamp(
                    Number(
                        job.progress
                    ) || 0,
                    0,
                    100
                )
            ),

        stage:
            job.stage,

        error:
            job.error

    });

}


/*
=========================================================
DOWNLOAD
=========================================================
*/

app.get(
    "/jobs/:jobId/download",
    downloadJob
);


/*
=========================================================
BACKWARD-COMPATIBILITY VIDEO DOWNLOAD
=========================================================
*/

app.get(
    "/merge-download/:jobId",
    downloadJob
);


/*
=========================================================
BACKWARD-COMPATIBILITY MP3 DOWNLOAD
=========================================================
*/

app.get(
    "/mp3-download/:jobId",
    downloadJob
);


function downloadJob(
    req,
    res
) {

    const job =
        jobs.get(
            req.params.jobId
        );


    if (!job) {

        return res.status(404).send(
            "Job nahi mili."
        );

    }


    if (
        job.status !==
        "completed"
    ) {

        return res.status(409).send(
            "File abhi ready nahi hai."
        );

    }


    if (
        !job.outputFile ||
        !fs.existsSync(
            job.outputFile
        )
    ) {

        return res.status(404).send(
            "Output file nahi mili."
        );

    }


    const extension =
        job.type === "mp3"
            ? ".mp3"
            : ".mp4";


    const filename =
        `${job.title || "VidsSave"}${extension}`;


    res.download(
        job.outputFile,
        filename,
        error => {

            if (error) {

                console.error(
                    "Download error:",
                    error
                );

            }


            cleanupJob(
                job.id
            );

        }
    );

}


/*
=========================================================
MEDIA PROCESS
=========================================================
*/

function runMediaJob(
    jobId
) {

    const job =
        jobs.get(
            jobId
        );


    if (!job) {
        return;
    }


    if (
        !fs.existsSync(
            job.inputFile
        )
    ) {

        markJobError(
            jobId,
            "Input file nahi mili."
        );

        return;

    }


    const command =
        ffmpeg(
            job.inputFile
        );


    if (
        job.type ===
        "mp3"
    ) {

        command
            .outputOptions([

                "-vn",

                "-c:a",
                "libmp3lame",

                "-b:a",
                "192k",

                "-ar",
                "44100"

            ])

            .format(
                "mp3"
            );

    } else {

        command
            .outputOptions([

                "-c:v",
                "libx264",

                "-preset",
                "veryfast",

                "-crf",
                "23",

                "-c:a",
                "aac",

                "-b:a",
                "192k",

                "-pix_fmt",
                "yuv420p",

                "-movflags",
                "+faststart"

            ])

            .format(
                "mp4"
            );

    }


    command.on(
        "start",
        commandLine => {

            console.log(
                `FFmpeg started: ${jobId}`
            );

            console.log(
                commandLine
            );

        }
    );


    command.on(
        "progress",
        progress => {

            const currentJob =
                jobs.get(
                    jobId
                );


            if (!currentJob) {
                return;
            }


            if (
                typeof progress.percent ===
                "number"
            ) {

                currentJob.progress =
                    clamp(
                        Math.round(
                            progress.percent
                        ),
                        0,
                        99
                    );

            }


            currentJob.stage =
                currentJob.type === "mp3"
                    ? "MP3 conversion ho rahi hai..."
                    : "MP4 conversion ho rahi hai...";

        }
    );


    command.on(
        "error",
        error => {

            console.error(
                `FFmpeg error ${jobId}:`,
                error
            );


            markJobError(
                jobId,
                formatFfmpegError(
                    error
                )
            );

        }
    );


    command.on(
        "end",
        () => {

            const currentJob =
                jobs.get(
                    jobId
                );


            if (!currentJob) {
                return;
            }


            if (
                !fs.existsSync(
                    currentJob.outputFile
                )
            ) {

                markJobError(
                    jobId,
                    "FFmpeg complete hua lekin output file nahi bani."
                );

                return;

            }


            currentJob.status =
                "completed";


            currentJob.progress =
                100;


            currentJob.stage =
                currentJob.type === "mp3"
                    ? "MP3 ready hai!"
                    : "MP4 ready hai!";


            currentJob.finishedAt =
                Date.now();


            console.log(
                `Job completed: ${jobId}`
            );

        }
    );


    command.save(
        job.outputFile
    );

}


/*
=========================================================
JOB ERROR
=========================================================
*/

function markJobError(
    jobId,
    message
) {

    const job =
        jobs.get(
            jobId
        );


    if (!job) {
        return;
    }


    job.status =
        "error";


    job.progress =
        0;


    job.stage =
        "Processing failed.";


    job.error =
        String(
            message ||
            "Processing failed."
        ).substring(
            0,
            1000
        );


    job.finishedAt =
        Date.now();


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
            error
        );

    }

}


/*
=========================================================
CLEANUP
=========================================================
*/

function cleanupJob(
    jobId
) {

    const job =
        jobs.get(
            jobId
        );


    if (!job) {
        return;
    }


    const files = [

        job.inputFile,

        job.outputFile

    ];


    for (
        const file
        of files
    ) {

        if (!file) {
            continue;
        }


        try {

            if (
                fs.existsSync(
                    file
                )
            ) {

                fs.unlinkSync(
                    file
                );

            }

        } catch (error) {

            console.error(
                "Cleanup error:",
                error
            );

        }

    }


    jobs.delete(
        jobId
    );


    if (job.mediaId) {

        mediaFiles.delete(
            job.mediaId
        );

    }

}


/*
=========================================================
OLD UPLOAD CLEANUP
=========================================================
*/

setInterval(
    () => {

        const now =
            Date.now();


        /*
        =============================================
        Uploaded files which were never processed
        =============================================
        */

        for (
            const [mediaId, media]
            of mediaFiles.entries()
        ) {

            if (
                now -
                media.createdAt >
                30 * 60 * 1000
            ) {

                try {

                    if (
                        fs.existsSync(
                            media.inputFile
                        )
                    ) {

                        fs.unlinkSync(
                            media.inputFile
                        );

                    }

                } catch (error) {

                    console.error(
                        error
                    );

                }


                mediaFiles.delete(
                    mediaId
                );

            }

        }


        /*
        =============================================
        Old jobs
        =============================================
        */

        for (
            const [jobId, job]
            of jobs.entries()
        ) {

            if (
                now -
                job.createdAt >
                30 * 60 * 1000
            ) {

                cleanupJob(
                    jobId
                );

            }

        }

    },
    5 * 60 * 1000
);


/*
=========================================================
HELPERS
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


function cleanFilename(
    value
) {

    return String(
        value || "VidsSave"
    )

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
            120
        )

        || "VidsSave";

}


function clamp(
    value,
    min,
    max
) {

    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );

}


function safeError(
    error
) {

    return String(
        error?.message ||
        error ||
        "Unknown error"
    ).substring(
        0,
        1000
    );

}


function formatFfmpegError(
    error
) {

    const message =
        safeError(
            error
        );


    if (
        message.includes(
            "Invalid data found"
        )
    ) {

        return (
            "Media file corrupt ya unsupported format mein hai."
        );

    }


    if (
        message.includes(
            "Unknown encoder"
        )
    ) {

        return (
            "Required FFmpeg encoder available nahi hai."
        );

    }


    return message;

}


/*
=========================================================
GLOBAL ERROR HANDLER
=========================================================
*/

app.use(
    (error, req, res, next) => {

        console.error(
            "Global error:",
            error
        );


        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(413).json({

                    error:
                        "File 500 MB se badi hai.",

                    maxMB:
                        500

                });

            }

        }


        if (
            !res.headersSent
        ) {

            return res.status(400).json({

                error:
                    error.message ||
                    "Request failed."

            });

        }


        next(error);

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
            `Version: 7.0.0`
        );

    }
);
