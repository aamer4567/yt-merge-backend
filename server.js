const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
ROOT
=========================================================
*/

app.get("/", (req, res) => {
    res.json({
        service: "VidsSave Media Processing API",
        status: "running",
        version: "4.0.0"
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
        uptime: Math.floor(process.uptime())
    });

});


/*
=========================================================
CREATE VIDEO + AUDIO MERGE JOB
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
                "Merge job create nahi ho saka."

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
                "MP3 job create nahi hui."

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


            cleanupJob(job.id);

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


            cleanupJob(job.id);

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
URL VALIDATION
=========================================================
*/

function isHttpUrl(value) {

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

function cleanFilename(name) {

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
FFMPEG ERROR CLEANER
=========================================================
*/

function getSafeFfmpegError(error) {

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
            "Source media server ne access deny kiya. " +
            "Authorized direct media URL use karein."
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
JOB CLEANUP
=========================================================
*/

function cleanupJob(jobId) {

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


    jobs.delete(jobId);

}


/*
=========================================================
AUTOMATIC OLD JOB CLEANUP
=========================================================
*/

setInterval(() => {

    const now =
        Date.now();


    for (
        const [id, job]
        of jobs.entries()
    ) {

        const age =
            now - job.createdAt;


        /*
         * 30 minutes
         */

        if (
            age >
            30 * 60 * 1000
        ) {

            cleanupJob(id);

        }

    }

}, 5 * 60 * 1000);


/*
=========================================================
GLOBAL ERROR HANDLER
=========================================================
*/

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);

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

    }
);
