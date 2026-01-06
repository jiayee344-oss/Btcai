const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

// OKX API代理
app.get('/api/okx/ticker/:symbol', async (req, res) => {
    try {
        const response = await axios.get(
            `https://www.okx.com/api/v5/market/ticker?instId=${req.params.symbol}`
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/okx/candles/:symbol', async (req, res) => {
    try {
        const { bar = '15m', limit = 30 } = req.query;
        const response = await axios.get(
            `https://www.okx.com/api/v5/market/candles?instId=${req.params.symbol}&bar=${bar}&limit=${limit}`
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`代理服务器运行在 http://localhost:${PORT}`);
});