import express from 'express';
import sequelize from './database';
import configRoutes from './routes/configRoutes';
import { getEthereumService } from './services/ethereumService';

const app = express();
const PORT = 8080;
const HOST = "localhost";


const ethereumService = getEthereumService();


app.use(express.json());



async function startServer() {
    await sequelize.sync();
    console.log('Database connected');

    app.use('/api/configurations', configRoutes);

    await ethereumService.loadConfigurations();

    app.listen(PORT, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
    });
}

startServer();

app.on("error", (err) => {
    console.log("Server error:", err);
});

