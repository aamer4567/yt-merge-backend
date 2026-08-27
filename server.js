const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "OPTIONS"]
}));

app.get("/", (req, res) => {
    res.status(200).send("VidsSave Merge Server is Running!");
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        ffmpeg: true
    });
});

app.get("/merge", async (req, res) => {

    const { videoUrl, audioUrl, title } = req.query;

    if (!videoUrl || !audioUrl) {
        return res.status(400).json({
            error: "videoUrl aur audioUrl dono required hain."
        });
    }

    try {

        const cleanTitle = (title || "video")
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
            .replace(/\s+/g, "_")
            .substring(0, 150);

        res.statusCode = 200;

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

        console.log("Merge request received");
        console.log("Video URL:", videoUrl.substring(0, 100));
        console.log("Audio URL:", audioUrl.substring(0, 100));

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
                "-movflags frag_keyframe+empty_moov",
                "-shortest"
            ])
            .format("mp4");

        command
            .on("start", commandLine => {
                console.log("FFmpeg started:");
                console.log(commandLine);
            })
            .on("progress", progress => {
                if (progress.percent) {
                    console.log(
                        `Progress: ${progress.percent.toFixed(1)}%`
                    );
                }
            })
            .on("error", (error) => {
                console.error("FFmpeg ERROR:");
                console.error(error);

                if (!res.headersSent) {
                    res.status(500).json({
                        error: "FFmpeg merge failed",
                        message: error.message
                    });
                } else {
                    res.end();
                }
            })
            .on("end", () => {
                console.log("FFmpeg merge completed");
            });

        command.pipe(res, {
            end: true
        });

    } catch (error) {

        console.error("Server error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Server error",
                message: error.message
            });
        }
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
