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
        version: "6.0.0",
        rapidAPI: false
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
        uptime: Math.floor(process.uptime())
    });

});


/*
=========================================================
CREATE MEDIA PROCESS JOB
=========================================================
*/

app.post("/media/process", async (req, res) => {

    try {

        const {
            url,
            output
        } = req.body || {};


        if (!url) {

            return res.status(400).json({
                error: "Media URL required hai."
            });

        }


        if (!isHttpUrl(url)) {

            return res.status(400).json({
                error:
                    "Valid HTTP/HTTPS media URL required hai."
            });

        }


        const requestedOutput =
            String(output || "mp4")
                .toLowerCase();


        if (
            requestedOutput !== "mp4" &&
            requestedOutput !== "mp3"
        ) {

            return res.status(400).json({
                error:
                    "Output sirf mp4 ya mp3 ho sakta hai."
            });

        }


        const jobId =
            crypto.randomUUID();


        const extension =
            requestedOutput === "mp3"
                ? "mp3"
                : "mp4";


        const outputFile =
            path.join(
                TEMP_DIR,
                `${jobId}.${extension}`
            );


        jobs.set(jobId, {

            id: jobId,

            type: requestedOutput,

            sourceUrl: url,

            status: "processing",

            progress: 0,

            stage:
                requestedOutput === "mp3"
                    ? "MP3 conversion start ho rahi hai..."
                    : "Video processing start ho rahi hai...",

            outputFile,

            error: null,

            createdAt: Date.now(),

            finishedAt: null

        });


        console.log(
            `Media job started: ${jobId}`
        );


        runMediaJob(
            jobId,
            url,
            requestedOutput,
            outputFile
        );


        return res.status(202).json({

            success: true,

            jobId,

            type: requestedOutput

        });


    } catch (error) {

        console.error(
            "Media process creation error:",
            error
        );


        return res.status(500).json({

            error:
                "Media processing start nahi ho saki.",

            details:
                safeError(error)

        });

    }

});


/*
=========================================================
JOB STATUS
=========================================================
*/

app.get("/jobs/:jobId", (req, res) => {

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
                    Number(job.progress) || 0,
                    0,
                    100
                )
            ),

        stage:
            job.stage,

        error:
            job.error,

        createdAt:
            job.createdAt,

        finishedAt:
            job.finishedAt

    });

});


/*
=========================================================
DOWNLOAD COMPLETED JOB
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
            !fs.existsSync(job.outputFile)
        ) {

            return res.status(404).send(
                "Processed file nahi mili."
            );

        }


        const extension =
            job.type === "mp3"
                ? "mp3"
                : "mp4";


        const filename =
            `${cleanFilename(job.title || "VidsSave")}.${extension}`;


        res.download(
            job.outputFile,
            filename,
            error => {

                if (error) {

                    console.error(
                        "Download response error:",
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
MEDIA PROCESSOR
=========================================================
*/

function runMediaJob(
    jobId,
    sourceUrl,
    outputType,
    outputFile
) {

    const job =
        jobs.get(jobId);


    if (!job) {
        return;
    }


    const command =
        ffmpeg();


    /*
    =====================================================
    INPUT
    =====================================================
    */

    command
        .input(sourceUrl)
        .inputOptions([

            "-reconnect 1",

            "-reconnect_streamed 1",

            "-reconnect_at_eof 1",

            "-reconnect_delay_max 5",

            "-rw_timeout 30000000"

        ]);


    /*
    =====================================================
    OUTPUT: MP3
    =====================================================
    */

    if (
        outputType ===
        "mp3"
    ) {

        command
            .outputOptions([

                "-vn",

                "-c:a libmp3lame",

                "-b:a 192k",

                "-ar 44100"

            ])

            .format("mp3");

    }


    /*
    =====================================================
    OUTPUT: MP4
    =====================================================
    */

    else {

        command
            .outputOptions([

                "-c:v libx264",

                "-preset veryfast",

                "-crf 23",

                "-c:a aac",

                "-b:a 192k",

                "-pix_fmt yuv420p",

                "-movflags +faststart"

            ])

            .format("mp4");

    }


    /*
    =====================================================
    START
    =====================================================
    */

    command.on(
        "start",
        commandLine => {

            console.log(
                `FFmpeg started ${jobId}`
            );

            console.log(
                commandLine
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            currentJob.stage =
                outputType === "mp3"
                    ? "MP3 conversion chal rahi hai..."
                    : "Video processing chal rahi hai...";

        }
    );


    /*
    =====================================================
    PROGRESS
    =====================================================
    */

    command.on(
        "progress",
        progress => {

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
                    clamp(
                        Math.round(
                            progress.percent
                        ),
                        0,
                        99
                    );

            }


            if (
                outputType ===
                "mp3"
            ) {

                currentJob.stage =
                    "MP3 conversion ho rahi hai...";

            } else {

                currentJob.stage =
                    "Video processing ho rahi hai...";

            }

        }
    );


    /*
    =====================================================
    ERROR
    =====================================================
    */

    command.on(
        "error",
        error => {

            console.error(
                `FFmpeg error ${jobId}:`,
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
                formatMediaError(
                    error
                );


            currentJob.finishedAt =
                Date.now();


            /*
             * Failed output cleanup
             */

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
                    "Failed output cleanup:",
                    cleanupError
                );

            }

        }
    );


    /*
    =====================================================
    COMPLETE
    =====================================================
    */

    command.on(
        "end",
        () => {

            console.log(
                `FFmpeg completed ${jobId}`
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

                currentJob.progress =
                    0;

                currentJob.stage =
                    "Output file missing.";

                currentJob.error =
                    "FFmpeg finished but output file nahi bani.";

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
                    : "Video ready hai!";


            currentJob.error =
                null;


            currentJob.finishedAt =
                Date.now();

        }
    );


    /*
    =====================================================
    SAVE
    =====================================================
    */

    command.save(
        outputFile
    );

}


/*
=========================================================
URL VALIDATION
=========================================================
*/

function isHttpUrl(value) {

    try {

        const parsed =
            new URL(
                String(value)
            );


        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );

    } catch {

        return false;

    }

}


/*
=========================================================
FILENAME
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


/*
=========================================================
CLAMP
=========================================================
*/

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


/*
=========================================================
ERROR MESSAGE
=========================================================
*/

function formatMediaError(
    error
) {

    if (!error) {

        return "Media processing failed.";

    }


    const message =
        String(
            error.message ||
            error
        );


    if (
        message.includes("403")
    ) {

        return (
            "Source server ne access deny kiya."
        );

    }


    if (
        message.includes("404")
    ) {

        return (
            "Source media file nahi mili."
        );

    }


    if (
        message.toLowerCase()
            .includes(
                "invalid data"
            )
    ) {

        return (
            "Source media format supported nahi hai."
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


/*
=========================================================
CLEANUP
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
            "Cleanup error:",
            error
        );

    }


    jobs.delete(
        jobId
    );

}


/*
=========================================================
AUTOMATIC CLEANUP
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


            /*
             * 30 minutes
             */

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
            `Temp directory: ${TEMP_DIR}`
        );

    }
);
