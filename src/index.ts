import express from 'express';
import sequelize from './database';

const app = express();
const PORT = 8080;
const HOST = "localhost"; 

app.use(express.json());



async function startServer() {
    await sequelize.sync();
        console.log('Database connected');
  
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  }
  
  startServer();
  
  app.on("error", (err) => {
    console.log("Server error:", err);
  });
  
