// server.js
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// Database connection
mongoose.connect('mongodb://localhost/androx_anime', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // limit each IP to 5 downloads per windowMs
});

// Video storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/videos');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

// Models
const User = require('./models/User');
const Video = require('./models/Video');
const Download = require('./models/Download');

// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'premium', 'admin'], default: 'user' },
    downloadCount: { type: Number, default: 0 },
    lastDownload: Date
});

userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

module.exports = mongoose.model('User', userSchema);

// models/Video.js
const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    filename: { type: String, required: true },
    qualities: [{
        quality: String,
        path: String,
        size: Number
    }],
    downloads: { type: Number, default: 0 },
    uploadDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', videoSchema);

// models/Download.js
const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    quality: String,
    downloadDate: { type: Date, default: Date.now },
    ip: String
});

module.exports = mongoose.model('Download', downloadSchema);

// middleware/auth.js
const jwt = require('jsonwebtoken');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded._id });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).send({ error: 'Please authenticate.' });
    }
};

// Routes for authentication
app.post('/api/users/register', async (req, res) => {
    try {
        const user = new User(req.body);
        await user.save();
        const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET);
        res.status(201).send({ user, token });
    } catch (error) {
        res.status(400).send(error);
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user || !await bcrypt.compare(req.body.password, user.password)) {
            throw new Error('Invalid login credentials');
        }
        const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET);
        res.send({ user, token });
    } catch (error) {
        res.status(400).send(error);
    }
});

// services/videoProcessor.js
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

class VideoProcessor {
    static async processVideo(inputPath, outputDir, videoId) {
        const qualities = ['480p', '720p', '1080p'];
        const processes = qualities.map(quality => {
            return this.convertToQuality(inputPath, outputDir, videoId, quality);
        });
        return Promise.all(processes);
    }

    static convertToQuality(inputPath, outputDir, videoId, quality) {
        return new Promise((resolve, reject) => {
            const resolution = this.getResolution(quality);
            const outputPath = path.join(outputDir, `${videoId}-${quality}.mp4`);

            ffmpeg(inputPath)
                .size(resolution)
                .videoBitrate(this.getBitrate(quality))
                .save(outputPath)
                .on('end', () => resolve({ quality, path: outputPath }))
                .on('error', reject);
        });
    }

    static getResolution(quality) {
        const resolutions = {
            '480p': '854x480',
            '720p': '1280x720',
            '1080p': '1920x1080'
        };
        return resolutions[quality];
    }

    static getBitrate(quality) {
        const bitrates = {
            '480p': '1000k',
            '720p': '2500k',
            '1080p': '5000k'
        };
        return bitrates[quality];
    }
}

module.exports = VideoProcessor;

// routes/downloads.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Download = require('../models/Download');
const Video = require('../models/Video');

router.get('/api/videos/:id/download/:quality', auth, downloadLimiter, async (req, res) => {
    try {
        const video = await Video.findById(req.params.id);
        if (!video) {
            return res.status(404).send();
        }

        // Check user download limits
        const canDownload = await checkDownloadLimits(req.user);
        if (!canDownload) {
            return res.status(429).send({ 
                error: 'Download limit reached. Please upgrade to premium or wait.' 
            });
        }

        // Record download
        const download = new Download({
            user: req.user._id,
            video: video._id,
            quality: req.params.quality,
            ip: req.ip
        });
        await download.save();

        // Update counts
        video.downloads += 1;
        req.user.downloadCount += 1;
        req.user.lastDownload = new Date();
        await Promise.all([video.save(), req.user.save()]);

        // Get video path
        const videoQuality = video.qualities.find(q => q.quality === req.params.quality);
        if (!videoQuality) {
            return res.status(404).send({ error: 'Quality not available' });
        }

        // Stream video
        res.download(videoQuality.path);
    } catch (error) {
        res.status(500).send(error);
    }
});

async function checkDownloadLimits(user) {
    if (user.role === 'premium') return true;

    const today = new Date();
    const downloadCount = await Download.countDocuments({
        user: user._id,
        downloadDate: {
            $gte: new Date(today.setHours(0,0,0,0)),
            $lt: new Date(today.setHours(23,59,59,999))
        }
    });

    return downloadCount < 5; // 5 downloads per day for free users
}

module.exports = router;
// public/js/download.js
class DownloadManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.baseUrl = '/api';
    }

    async downloadVideo(videoId, quality) {
        try {
            const response = await fetch(
                `${this.baseUrl}/videos/${videoId}/download/${quality}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Download failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `video-${videoId}-${quality}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download error:', error);
            throw error;
        }
    }
}

// Usage in your frontend code
const downloadManager = new DownloadManager();

async function initiateDownload(videoId, quality) {
    try {
        await downloadManager.downloadVideo(videoId, quality);
        showSuccess('Download completed!');
    } catch (error) {
        showError(error.message);
    }
}