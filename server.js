const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

const RAPIDAPI_HOST =
    "youtube-media-downloader.p.rapidapi.com";

const TEMP_DIR = "/tmp/vidssave";

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}

const jobs = new Map();


/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {

    res.send(
        "VidsSave Backend is Running!"
    );

});


/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

    res.json({

        status: "ok",

        rapidApiKeyConfigured:
            !!RAPIDAPI_KEY,

        ffmpeg: true,

        uptime:
            Math.round(process.uptime())

    });

});


/* =========================================================
   VIDEO DETAILS
========================================================= */

app.get("/video", async (req, res) => {

    try {

        const videoId =
            String(req.query.videoId || "").trim();


        if (!videoId) {

            return res.status(400).json({

                error:
                    "videoId required hai."

            });

        }


        if (!RAPIDAPI_KEY) {

            return res.status(500).json({

                error:
                    "RAPIDAPI_KEY Render Environment mein configured nahi hai."

            });

        }


        const apiUrl =
            `https://${RAPIDAPI_HOST}/v2/video/details` +
            `?videoId=${encodeURIComponent(videoId)}` +
            `&urlAccess=normal` +
            `&videos=auto` +
            `&audios=auto`;


        console.log(
            "Fetching video details:",
            videoId
        );


        const response =
            await fetch(apiUrl, {

                method: "GET",

                headers: {

                    "x-rapidapi-key":
                        RAPIDAPI_KEY,

                    "x-rapidapi-host":
                        RAPIDAPI_HOST,

                    "Content-Type":
                        "application/json"

                }

            });


        const text =
            await response.text();


        let data;


        try {

            data =
                JSON.parse(text);

        } catch {

            console.error(
                "RapidAPI raw response:",
                text.substring(0, 1000)
            );

            return res.status(502).json({

                error:
                    "RapidAPI ne valid JSON response nahi diya."

            });

        }


        if (!response.ok) {

            console.error(
                "RapidAPI error:",
                response.status,
                data
            );

            return res.status(response.status).json({

                error:
                    "RapidAPI request failed.",

                details:
                    data

            });

        }


        if (!data.title) {

            return res.status(404).json({

                error:
                    "Video information nahi mili."

            });

        }


        /*
         * Debug ke liye important:
         * videos.items / audios.items ka count
         */

        console.log(
            "Video formats:",
            data.videos &&
            Array.isArray(data.videos.items)
                ? data.videos.items.length
                : 0
        );


        console.log(
            "Audio formats:",
            data.audios &&
            Array.isArray(data.audios.items)
                ? data.audios.items.length
                : 0
        );


        res.json(data);


    } catch (error) {

        console.error(
            "Video API error:",
            error
        );


        res.status(500).json({

            error:
                "Video information fetch nahi ho saki.",

            details:
                error.message

        });

    }

});


/* =========================================================
   MERGE
========================================================= */

app.get("/merge", async (req, res) => {

    try {

        const videoUrl =
            String(req.query.videoUrl || "").trim();

        const audioUrl =
            String(req.query.audioUrl || "").trim();

        const title =
            String(req.query.title || "video").trim();


        if (!videoUrl || !audioUrl) {

            return res.status(400).json({

                error:
                    "videoUrl aur audioUrl dono required hain."

            });

        }


        /*
         * Security:
         * Sirf HTTP/HTTPS URLs allow.
         */

        if (
            !isHttpUrl(videoUrl) ||
            !isHttpUrl(audioUrl)
        ) {

            return res.status(400).json({

                error:
                    "Invalid media URL."

            });

        }


        const jobId =
            crypto.randomUUID();


        const outputFile =
            path.join(
                TEMP_DIR,
                `${jobId}.mp4`
            );


        jobs.set(jobId, {

            id:
                jobId,

            status:
                "processing",

            progress:
                0,

            stage:
                "FFmpeg processing start ho rahi hai...",

            outputFile,

            title:
                cleanFilename(title),

            error:
                null,

            createdAt:
                Date.now()

        });


        console.log(
            `Starting merge job: ${jobId}`
        );


        runMergeJob(
            jobId,
            videoUrl,
            audioUrl,
            outputFile
        );


        res.json({

            success:
                true,

            jobId

        });


    } catch (error) {

        console.error(
            "Merge start error:",
            error
        );


        res.status(500).json({

            error:
                "Merge start nahi ho saka.",

            details:
                error.message

        });

    }

});


/* =========================================================
   MERGE STATUS
========================================================= */

app.get(
    "/merge-status/:jobId",
    (req, res) => {

        const job =
            jobs.get(
                req.params.jobId
            );


        if (!job) {

            return res.status(404).json({

                error:
                    "Merge job nahi mila."

            });

        }


        res.json({

            success:
                true,

            status:
                job.status,

            progress:
                Math.round(
                    job.progress || 0
                ),

            stage:
                job.stage,

            error:
                job.error

        });

    }
);


/* =========================================================
   MERGE DOWNLOAD
========================================================= */

app.get(
    "/merge-download/:jobId",
    (req, res) => {

        const job =
            jobs.get(
                req.params.jobId
            );


        if (!job) {

            return res.status(404).send(
                "Merge job nahi mila."
            );

        }


        if (
            job.status !==
            "completed"
        ) {

            return res.status(409).send(
                "Video abhi ready nahi hai."
            );

        }


        if (
            !fs.existsSync(
                job.outputFile
            )
        ) {

            return res.status(404).send(
                "Processed video file nahi mili."
            );

        }


        res.download(

            job.outputFile,

            `${job.title}.mp4`,

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


/* =========================================================
   MP3
========================================================= */

app.get("/mp3", (req, res) => {

    const audioUrl =
        String(req.query.audioUrl || "").trim();

    const title =
        String(req.query.title || "audio").trim();


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


    jobs.set(jobId, {

        id:
            jobId,

        status:
            "processing",

        progress:
            0,

        stage:
            "MP3 conversion start ho rahi hai...",

        outputFile,

        title:
            cleanFilename(title),

        error:
            null,

        createdAt:
            Date.now()

    });


    console.log(
        `Starting MP3 job: ${jobId}`
    );


    runMp3Job(
        jobId,
        audioUrl,
        outputFile
    );


    res.json({

        success:
            true,

        jobId

    });

});


/* =========================================================
   MP3 DOWNLOAD
========================================================= */

app.get(
    "/mp3-download/:jobId",
    (req, res) => {

        const job =
            jobs.get(
                req.params.jobId
            );


        if (!job) {

            return res.status(404).send(
                "MP3 job nahi mila."
            );

        }


        if (
            job.status !==
            "completed"
        ) {

            return res.status(409).send(
                "MP3 abhi ready nahi hai."
            );

        }


        if (
            !fs.existsSync(
                job.outputFile
            )
        ) {

            return res.status(404).send(
                "MP3 file nahi mili."
            );

        }


        res.download(

            job.outputFile,

            `${job.title}.mp3`,

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

    }
);


/* =========================================================
   FFmpeg HTTP OPTIONS
========================================================= */

function mediaInputOptions() {

    return [

        "-user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

        "-headers",
        "Referer: https://www.youtube.com/\r\nOrigin: https://www.youtube.com\r\n",

        "-reconnect",
        "1",

        "-reconnect_streamed",
        "1",

        "-reconnect_at_eof",
        "1",

        "-reconnect_delay_max",
        "10",

        "-rw_timeout",
        "30000000"

    ];

}


/* =========================================================
   RUN MERGE JOB
========================================================= */

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


    /*
     * IMPORTANT:
     *
     * FFmpeg ko dono signed URLs ke saath
     * proper HTTP headers diye ja rahe hain.
     */

    const command =
        ffmpeg();


    command
        .input(videoUrl)
        .inputOptions(
            mediaInputOptions()
        );


    command
        .input(audioUrl)
        .inputOptions(
            mediaInputOptions()
        );


    command
        .outputOptions([

            "-map 0:v:0",

            "-map 1:a:0",

            /*
             * Video re-encode
             */

            "-c:v libx264",

            "-preset veryfast",

            "-crf 23",

            /*
             * Audio
             */

            "-c:a aac",

            "-b:a 192k",

            /*
             * Compatibility
             */

            "-pix_fmt yuv420p",

            /*
             * Stop when shortest stream ends
             */

            "-shortest",

            /*
             * MP4 streaming optimization
             */

            "-movflags +faststart"

        ])

        .format("mp4")


        .on(
            "start",
            commandLine => {

                console.log(
                    `FFmpeg started ${jobId}`
                );

                console.log(
                    commandLine
                );

            }
        )


        .on(
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
                        Math.min(
                            99,
                            Math.round(
                                progress.percent
                            )
                        );

                }


                currentJob.stage =
                    "Video + Audio merge ho raha hai...";

            }
        )


        .on(
            "stderr",
            line => {

                /*
                 * Render logs mein FFmpeg ka
                 * useful error output dikhega.
                 */

                if (
                    line &&
                    (
                        line.includes("403") ||
                        line.includes("401") ||
                        line.includes("Error") ||
                        line.includes("HTTP")
                    )
                ) {

                    console.error(
                        `FFmpeg ${jobId}:`,
                        line
                    );

                }

            }
        )


        .on(
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
                    normalizeFfmpegError(
                        error
                    );

            }
        )


        .on(
            "end",
            () => {

                console.log(
                    `Merge completed: ${jobId}`
                );


                const currentJob =
                    jobs.get(jobId);


                if (!currentJob) {
                    return;
                }


                currentJob.status =
                    "completed";


                currentJob.progress =
                    100;


                currentJob.stage =
                    "Video ready hai.";

            }
        )


        .save(outputFile);

}


/* =========================================================
   RUN MP3 JOB
========================================================= */

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

        .inputOptions(
            mediaInputOptions()
        )

        .outputOptions([

            "-vn",

            "-c:a libmp3lame",

            "-b:a 192k",

            "-ar 44100"

        ])

        .format("mp3")


        .on(
            "start",
            commandLine => {

                console.log(
                    `MP3 FFmpeg started: ${jobId}`
                );

                console.log(
                    commandLine
                );

            }
        )


        .on(
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
                        Math.min(
                            99,
                            Math.round(
                                progress.percent
                            )
                        );

                }


                currentJob.stage =
                    "MP3 conversion ho rahi hai...";

            }
        )


        .on(
            "stderr",
            line => {

                if (
                    line &&
                    (
                        line.includes("403") ||
                        line.includes("401") ||
                        line.includes("Error") ||
                        line.includes("HTTP")
                    )
                ) {

                    console.error(
                        `MP3 FFmpeg ${jobId}:`,
                        line
                    );

                }

            }
        )


        .on(
            "error",
            error => {

                console.error(
                    `MP3 FFmpeg error ${jobId}:`,
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
                    normalizeFfmpegError(
                        error
                    );

            }
        )


        .on(
            "end",
            () => {

                console.log(
                    `MP3 completed: ${jobId}`
                );


                const currentJob =
                    jobs.get(jobId);


                if (!currentJob) {
                    return;
                }


                currentJob.status =
                    "completed";


                currentJob.progress =
                    100;


                currentJob.stage =
                    "MP3 ready hai.";

            }
        )


        .save(outputFile);

}


/* =========================================================
   OPTIONAL MEDIA PROXY
========================================================= */

/*
 * Ye endpoint useful hai agar frontend ko
 * kisi returned media URL ko backend ke through
 * stream karna ho.
 *
 * NOTE:
 * Signed Googlevideo URLs IP/session-bound ho sakte hain.
 * Isliye ye endpoint 403 ko magically bypass nahi karta.
 */

app.get("/media-proxy", async (req, res) => {

    try {

        const mediaUrl =
            String(
                req.query.url || ""
            ).trim();


        if (!mediaUrl) {

            return res.status(400).send(
                "url required hai."
            );

        }


        if (!isHttpUrl(mediaUrl)) {

            return res.status(400).send(
                "Invalid URL."
            );

        }


        const response =
            await fetch(
                mediaUrl,
                {

                    method:
                        "GET",

                    headers: {

                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

                        "Referer":
                            "https://www.youtube.com/",

                        "Origin":
                            "https://www.youtube.com"

                    }

                }
            );


        if (!response.ok) {

            return res.status(
                response.status
            ).send(
                `Media server returned HTTP ${response.status}`
            );

        }


        const contentType =
            response.headers.get(
                "content-type"
            );


        if (contentType) {

            res.setHeader(
                "Content-Type",
                contentType
            );

        }


        const contentLength =
            response.headers.get(
                "content-length"
            );


        if (contentLength) {

            res.setHeader(
                "Content-Length",
                contentLength
            );

        }


        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );


        if (
            response.body &&
            response.body.pipeTo
        ) {

            const nodeStream =
                require("stream")
                    .Readable
                    .fromWeb(
                        response.body
                    );


            nodeStream.pipe(res);


        } else {

            const buffer =
                Buffer.from(
                    await response.arrayBuffer()
                );


            res.end(buffer);

        }


    } catch (error) {

        console.error(
            "Media proxy error:",
            error
        );


        if (!res.headersSent) {

            res.status(500).send(
                "Media proxy failed: " +
                error.message
            );

        }

    }

});


/* =========================================================
   HELPERS
========================================================= */

function isHttpUrl(value) {

    try {

        const url =
            new URL(value);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch {

        return false;

    }

}


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

        .substring(
            0,
            150
        );

}


function normalizeFfmpegError(error) {

    if (!error) {

        return "Unknown FFmpeg error.";

    }


    const message =
        String(
            error.message ||
            error
        );


    if (
        message.includes("403") ||
        message.includes("Forbidden")
    ) {

        return (
            "Media server ne 403 Forbidden diya. " +
            "RapidAPI ka temporary Googlevideo URL " +
            "Render server se accessible nahi hai."
        );

    }


    if (
        message.includes("401")
    ) {

        return (
            "Media URL unauthorized (401). " +
            "Temporary media URL expire ho sakta hai."
        );

    }


    return message;

}


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
            "Temp file cleanup error:",
            error
        );

    }


    jobs.delete(jobId);

}


/* =========================================================
   CLEAN OLD JOBS
========================================================= */

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

                cleanupJob(id);

            }

        }

    },
    5 * 60 * 1000
);


/* =========================================================
   SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `VidsSave server running on port ${PORT}`
        );

    }
);
