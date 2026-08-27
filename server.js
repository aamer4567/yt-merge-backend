const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");

const app = express();

app.use(cors());

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "youtube-media-downloader.p.rapidapi.com";

app.get("/", (req, res) => {
    res.send("VidsSave Backend is Running!");
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        rapidApiKeyConfigured: !!RAPIDAPI_KEY
    });
});

/*
 * Video details
 *
 * Frontend sirf videoId bhejega.
 * RapidAPI key server ke andar rahegi.
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
                error: "RAPIDAPI_KEY Render environment mein configured nahi hai."
            });
        }

        const apiUrl =
            `https://${RAPIDAPI_HOST}/v2/video/details` +
            `?videoId=${encodeURIComponent(videoId)}` +
            `&videos=auto&audios=auto`;

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
                error: "RapidAPI ne valid JSON response nahi diya."
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                error: "RapidAPI request failed.",
                details: data
            });
        }

        if (!data.title) {
            return res.status(404).json({
                error: "Video details nahi mile."
            });
        }

        res.json(data);

    } catch (error) {
        console.error("Video API error:", error);

        res.status(500).json({
            error: "Video information fetch nahi ho saki."
        });
    }
});


/*
 * Video + Audio merge
 */
app.get("/merge", (req, res) => {

    const {
        videoUrl,
        audioUrl,
        title
    } = req.query;

    if (!videoUrl || !audioUrl) {
        return res.status(400).send(
            "videoUrl aur audioUrl dono required hain."
        );
    }

    const cleanTitle = (title || "video")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, "_")
        .substring(0, 150);

    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${cleanTitle}.mp4"`
    );

    res.setHeader(
        "Content-Type",
        "video/mp4"
    );

    res.setHeader(
        "Cache-Control",
        "no-cache"
    );

    console.log("Starting FFmpeg merge...");

    const command = ffmpeg()
        .input(videoUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ])

        .input(audioUrl)
        .inputOptions([
            "-reconnect 1",
            "-reconnect_streamed 1",
            "-reconnect_delay_max 5"
        ])

        .outputOptions([
            "-map 0:v:0",
            "-map 1:a:0",
            "-c:v copy",
            "-c:a aac",
            "-b:a 128k",
            "-shortest",
            "-movflags frag_keyframe+empty_moov"
        ])

        .format("mp4")

        .on("start", commandLine => {
            console.log("FFmpeg command:");
            console.log(commandLine);
        })

        .on("progress", progress => {
            if (progress.percent) {
                console.log(
                    `Progress: ${progress.percent.toFixed(1)}%`
                );
            }
        })

        .on("error", error => {
            console.error("FFmpeg Error:", error.message);

            if (!res.headersSent) {
                res.status(500).send(
                    "Video merge fail ho gaya."
                );
            } else {
                res.end();
            }
        })

        .on("end", () => {
            console.log("FFmpeg merge completed.");
        });

    command.pipe(res, {
        end: true
    });
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Server running on port ${PORT}`
    );
});
