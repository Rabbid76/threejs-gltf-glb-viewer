import express from 'express';
import path from 'path';

const port: number = 3333;
const hostname: string = '127.0.0.1';

class App {
  private port: number;
  private app: express.Express;

  constructor(portNumber: number) {
    this.port = portNumber;
    this.app = express();
    this.app.use(express.static(path.join(__dirname, '../client')));
  }

  public Start() {
    this.app.listen(this.port, () => {
      console.log(`Server running at http://${hostname}:${port}/`);
    });
  }
}

new App(port).Start();
