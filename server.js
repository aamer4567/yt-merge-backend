const express = require('express');
const cors = require('cors');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());

// Render environment me FFmpeg static binary link karna
ffmpeg.setFfmpegPath(ffmpegPath);

app.get('/merge', (req, res) => {
    const { videoUrl, audioUrl, title } = req.query;

    if (!videoUrl || !audioUrl) {
        return res.status(400).send('Video aur Audio URLs zaroori hain.');
    }

    // Direct download ke liye header (is se naya page play nahi hoga, direct download hoga)
    const cleanTitle = (title || 'video').replace(/[^a-zA-Z0-9]/g, '_');
    res.header('Content-Disposition', `attachment; filename="${cleanTitle}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Video + Audio stream merge karna
    ffmpeg()
        .input(videoUrl)
        .input(audioUrl)
        .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-shortest'
        ])
        .format('mp4')
        .on('error', (err) => {
            console.error('FFmpeg Error:', err);
            if (!res.headersSent) {
                res.status(500).send('Merging process fail ho gaya.');
            }
        })
        .pipe(res, { end: true });
});

app.get('/', (req, res) => {
    res.send('Merge Server is Running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
