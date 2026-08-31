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

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, {
        recursive: true
    });
}

const jobs = new Map();

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },

        filename: (req, file, cb) => {

            const extension =
                path.extname(file.originalname)
                    .toLowerCase();

            const filename =
                `${crypto.randomUUID()}${extension}`;

            cb(null, filename);
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

        const extension =
            path.extname(file.originalname)
                .toLowerCase();

        if (!allowed.includes(extension)) {

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
        service: "VidsSave Media Processing API",
        status: "running",
        version: "6.1.0",
        rapidAPI: false,
        upload: true
    });

});


/*
=========================================================
HEALTH
=========================================================
*/

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        ffmpeg: true,
        rapidAPI: false,
        upload: true,
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
UPLOAD MEDIA
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


            const filePath =
                req.file.path;


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


            const mediaId =
                crypto.randomUUID();


            const job =
                jobs.set(
                    mediaId,
                    {
                        id: mediaId,

                        type:
                            isAudio
                                ? "audio"
                                : "video",

                        status:
                            "uploaded",

                        progress: 0,

                        stage:
                            "File upload complete.",

                        inputFile:
                            filePath,

                        outputFile:
                            null,

                        title:
                            cleanFilename(
                                path.basename(
                                    originalName,
                                    extension
                                )
                            ),

                        error:
                            null,

                        createdAt:
                            Date.now(),

                        finishedAt:
                            null
                    }
                );


            return res.status(201).json({

                success: true,

                mediaId,

                filename:
                    originalName,

                type:
                    job.type,

                size:
                    req.file.size

            });


        } catch (error) {

            console.error(
                "Upload error:",
                error
            );


            if (
                req.file &&
                req.file.path &&
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
                    "File upload failed.",

                details:
                    safeError(error)

            });

        }

    }
);


/*
=========================================================
PROCESS UPLOADED MEDIA
=========================================================
*/

app.post(
    "/media/process-upload",
    async (req, res) => {

        try {

            const {
                mediaId,
                output
            } = req.body || {};


            if (!mediaId) {

                return res.status(400).json({

                    error:
                        "mediaId required hai."

                });

            }


            const job =
                jobs.get(
                    mediaId
                );


            if (!job) {

                return res.status(404).json({

                    error:
                        "Uploaded media nahi mili."

                });

            }


            if (
                job.status !== "uploaded"
            ) {

                return res.status(409).json({

                    error:
                        "Ye media already process ho chuki hai ya processing mein hai."

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


            /*
             * Audio input + MP4 output is not useful.
             */

            if (
                job.type === "audio" &&
                requestedOutput === "mp4"
            ) {

                return res.status(400).json({

                    error:
                        "Audio file ko MP4 video mein convert nahi kiya ja sakta."

                });

            }


            const outputExtension =
                requestedOutput === "mp3"
                    ? ".mp3"
                    : ".mp4";


            const outputFile =
                path.join(
                    TEMP_DIR,
                    `${mediaId}${outputExtension}`
                );


            job.status =
                "processing";


            job.progress =
                0;


            job.stage =
                requestedOutput === "mp3"
                    ? "MP3 conversion start ho rahi hai..."
                    : "MP4 conversion start ho rahi hai...";


            job.outputFile =
                outputFile;


            runUploadedMediaJob(
                mediaId,
                requestedOutput
            );


            return res.status(202).json({

                success: true,

                jobId:
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
                    "Media processing start nahi ho saki.",

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
    (req, res) => {

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


        return res.json({

            success: true,

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
);


/*
=========================================================
DOWNLOAD RESULT
=========================================================
*/

app.get(
    "/jobs/:jobId/download",
    (req, res) => {

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
            path.extname(
                job.outputFile
            );


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
);


/*
=========================================================
PROCESS LOCAL UPLOAD
=========================================================
*/

function runUploadedMediaJob(
    jobId,
    outputType
) {

    const job =
        jobs.get(
            jobId
        );


    if (!job) {
        return;
    }


    if (
        !job.inputFile ||
        !fs.existsSync(
            job.inputFile
        )
    ) {

        job.status =
            "error";

        job.stage =
            "Input file nahi mili.";

        job.error =
            "Uploaded media file missing.";

        return;

    }


    const command =
        ffmpeg(
            job.inputFile
        );


    if (
        outputType ===
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
                `FFmpeg upload job started: ${jobId}`
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
                outputType === "mp3"
                    ? "MP3 conversion ho rahi hai..."
                    : "MP4 conversion ho rahi hai...";

        }
    );


    command.on(
        "error",
        error => {

            console.error(
                `FFmpeg upload error ${jobId}:`,
                error
            );


            const currentJob =
                jobs.get(
                    jobId
                );


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
                formatFfmpegError(
                    error
                );


            try {

                if (
                    currentJob.outputFile &&
                    fs.existsSync(
                        currentJob.outputFile
                    )
                ) {

                    fs.unlinkSync(
                        currentJob.outputFile
                    );

                }

            } catch (cleanupError) {

                console.error(
                    cleanupError
                );

            }

        }
    );


    command.on(
        "end",
        () => {

            console.log(
                `FFmpeg upload job completed: ${jobId}`
            );


            const currentJob =
                jobs.get(
                    jobId
                );


            if (!currentJob) {
                return;
            }


            if (
                !currentJob.outputFile ||
                !fs.existsSync(
                    currentJob.outputFile
                )
            ) {

                currentJob.status =
                    "error";

                currentJob.stage =
                    "Output file missing.";

                currentJob.error =
                    "FFmpeg completed but output file nahi bani.";

                currentJob.finishedAt =
                    Date.now();

                return;

            }


            currentJob.status =
                "completed";


            currentJob.progress =
                100;


            currentJob.stage =
                outputType === "mp3"
                    ? "MP3 ready hai!"
                    : "MP4 ready hai!";


            currentJob.finishedAt =
                Date.now();

        }
    );


    command.save(
        job.outputFile
    );

}


/*
=========================================================
HELPERS
=========================================================
*/

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

            if (
                now -
                job.createdAt >
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
MULTER ERROR HANDLER
=========================================================
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(413).json({

                    error:
                        "File bahut badi hai.",

                    maxMB:
                        MAX_FILE_SIZE /
                        1024 /
                        1024

                });

            }


            return res.status(400).json({

                error:
                    error.message

            });

        }


        if (
            error
        ) {

            console.error(
                "Global error:",
                error
            );


            return res.status(500).json({

                error:
                    error.message ||
                    "Internal server error."

            });

        }


        next();

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
            `Port: ${PORT}`
        );

        console.log(
            `Upload directory: ${UPLOAD_DIR}`
        );

    }
);
