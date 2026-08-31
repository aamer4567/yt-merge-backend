const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

const RAPIDAPI_HOST =
    "youtube-media-downloader.p.rapidapi.com";

const jobs = new Map();

const TEMP_DIR = "/tmp/vidssave";

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}


/*
=========================================================
ROOT
=========================================================
*/

app.get("/", (req, res) => {
    res.send("VidsSave Backend is Running!");
});


/*
=========================================================
HEALTH
=========================================================
*/

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        rapidApiKeyConfigured: !!RAPIDAPI_KEY,
        ffmpeg: true
    });

});


/*
=========================================================
VIDEO DETAILS
=========================================================
*/

app.get("/video", async (req, res) => {

    try {

        const { videoId } = req.query;

        if (!videoId) {

            return res.status(400).json({
                error: "videoId required hai."
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
            `&urlAccess=normal&videos=auto&audios=auto`;


        console.log("Fetching video details:", videoId);


        const response = await fetch(apiUrl, {

            method: "GET",

            headers: {
                "x-rapidapi-key": RAPIDAPI_KEY,
                "x-rapidapi-host": RAPIDAPI_HOST
            }

        });


        const text = await response.text();

        let data;

        try {

            data = JSON.parse(text);

        } catch {

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
                error: "RapidAPI request failed.",
                details: data
            });

        }


        if (!data.title) {

            return res.status(404).json({
                error:
                    "Video information nahi mili."
            });

        }


        res.json(data);

    } catch (error) {

        console.error(
            "Video API error:",
            error
        );

        res.status(500).json({
            error:
                "Video information fetch nahi ho saki."
        });

    }

});


/*
=========================================================
CREATE MERGE JOB
=========================================================
*/

app.get("/merge", (req, res) => {

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


    const jobId =
        crypto.randomUUID();


    const outputFile =
        path.join(
            TEMP_DIR,
            `${jobId}.mp4`
        );


    jobs.set(jobId, {

        id: jobId,

        status: "processing",

        progress: 0,

        stage: "FFmpeg processing start ho rahi hai...",

        outputFile,

        title:
            cleanFilename(
                title || "video"
            ),

        error: null,

        createdAt: Date.now()

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


    /*
     * Browser ko job ID milegi.
     */

    res.json({

        success: true,

        jobId

    });

});


/*
=========================================================
MERGE STATUS
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
                "Merge job nahi mila."
        });

    }


    res.json({

        success: true,

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
MERGE DOWNLOAD
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


    if (job.status !== "completed") {

        return res.status(409).send(
            "Video abhi ready nahi hai."
        );

    }


    if (!fs.existsSync(job.outputFile)) {

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


            /*
             * Download ke baad temporary file delete.
             */

            try {

                if (
                    fs.existsSync(
                        job.outputFile
                    )
                ) {

                    fs.unlinkSync(
                        job.outputFile
                    );

                }

            } catch (e) {

                console.error(
                    "Temp file cleanup error:",
                    e
                );

            }


            jobs.delete(
                job.id
            );

        }

    );

});


/*
=========================================================
MP3 JOB
=========================================================
*/

app.get("/mp3", (req, res) => {

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


    const jobId =
        crypto.randomUUID();


    const outputFile =
        path.join(
            TEMP_DIR,
            `${jobId}.mp3`
        );


    jobs.set(jobId, {

        id: jobId,

        status: "processing",

        progress: 0,

        stage:
            "MP3 conversion start ho rahi hai...",

        outputFile,

        title:
            cleanFilename(
                title || "audio"
            ),

        error: null,

        createdAt: Date.now()

    });


    runMp3Job(
        jobId,
        audioUrl,
        outputFile
    );


    res.json({

        success: true,

        jobId

    });

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


    if (job.status !== "completed") {

        return res.status(409).send(
            "MP3 abhi ready nahi hai."
        );

    }


    if (!fs.existsSync(job.outputFile)) {

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


            try {

                if (
                    fs.existsSync(
                        job.outputFile
                    )
                ) {

                    fs.unlinkSync(
                        job.outputFile
                    );

                }

            } catch (e) {

                console.error(e);

            }


            jobs.delete(
                job.id
            );

        }

    );

});


/*
=========================================================
RUN MERGE
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


    /*
     * Video input
     */

    command
        .input(videoUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ]);


    /*
     * Audio input
     */

    command
        .input(audioUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ]);


    command
        .outputOptions([

            /*
             * Video + audio mapping
             */

            "-map 0:v:0",
            "-map 1:a:0",

            /*
             * Standard compatible video
             */

            "-c:v libx264",
            "-preset veryfast",
            "-crf 23",

            /*
             * Standard compatible audio
             */

            "-c:a aac",
            "-b:a 192k",

            /*
             * KMPlayer compatibility
             */

            "-pix_fmt yuv420p",

            /*
             * End when shortest stream ends
             */

            "-shortest",

            /*
             * MP4 optimization
             */

            "-movflags +faststart"

        ])

        .format("mp4")

        .on("start", commandLine => {

            console.log(
                `FFmpeg started ${jobId}`
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
                        Math.round(
                            progress.percent
                        )
                    );

            }


            currentJob.stage =
                "Video + Audio merge ho raha hai...";

        })

        .on("error", error => {

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

            currentJob.progress = 0;

            currentJob.stage =
                "Processing failed.";

            currentJob.error =
                error.message;

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
RUN MP3
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
                `MP3 FFmpeg started: ${jobId}`
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
                        Math.round(
                            progress.percent
                        )
                    );

            }


            currentJob.stage =
                "MP3 conversion ho rahi hai...";

        })

        .on("error", error => {

            console.error(
                `MP3 FFmpeg error:`,
                error
            );


            const currentJob =
                jobs.get(jobId);


            if (!currentJob) {
                return;
            }


            currentJob.status =
                "error";

            currentJob.progress = 0;

            currentJob.stage =
                "MP3 conversion failed.";

            currentJob.error =
                error.message;

        })

        .on("end", () => {

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

        })

        .save(outputFile);

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

        .substring(
            0,
            150
        );

}


/*
=========================================================
CLEAN OLD JOBS
=========================================================
*/

setInterval(() => {

    const now =
        Date.now();


    for (
        const [id, job]
        of jobs.entries()
    ) {

        /*
         * 30 minutes old jobs
         * delete karo.
         */

        if (
            now - job.createdAt >
            30 * 60 * 1000
        ) {

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


            jobs.delete(id);

        }

    }

}, 5 * 60 * 1000);


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
            `VidsSave server running on port ${PORT}`
        );

    }
);
