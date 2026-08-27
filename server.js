const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => res.send('Merge Server is Running!'));

app.get('/merge', (req, res) => {
    const videoUrl = req.query.videoUrl;
    const audioUrl = req.query.audioUrl;
    const title = req.query.title || 'Video';

    if (!videoUrl || !audioUrl) {
        return res.status(400).send('Video and Audio URLs are required!');
    }

    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_");
    res.header('Content-Disposition', `attachment; filename="${safeTitle}_Merged.mp4"`);
    res.header('Content-Type', 'video/mp4');

    const ffmpeg = spawn('ffmpeg', [
        '-i', videoUrl,
        '-i', audioUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov',
        'pipe:1'
    ]);

    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
