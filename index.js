// index.js
const express = require('express');
const cors = require('cors');
const { sendMessages } = require('./sendmessage');
const { handleWebhook } = require('./weebhook'); // Nuevo archivo que contendrá la lógica del webhook
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());


app.post('/webhook/callbell', handleWebhook);


app.post('/send-messages', async (req, res) => {
    try {
        await sendMessages();
        res.status(200).send('Mensajes enviados correctamente');
    } catch (error) {
        res.status(500).send('Error al enviar los mensajes');
    }
});


// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});

