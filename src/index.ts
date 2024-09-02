import express from 'express';
import sequelize from './database';
import configRoutes from './routes/configRoutes';

const app = express();
const PORT = 8080;
const HOST = "localhost";

app.use(express.json());



async function startServer() {
    await sequelize.sync();
    console.log('Database connected');

    app.use('/api/configurations', configRoutes);


    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

startServer();

app.on("error", (err) => {
    console.log("Server error:", err);
});

