# Ethereum Monitor

Ethereum Monitor is an application designed to monitor Ethereum transactions. It includes features for managing configurations, monitoring transactions with Infura.

## Technologies

The project uses the following technologies and libraries:

- **Node.js** - JavaScript runtime environment for server-side code.
- **Express.js** - Minimal and flexible Node.js web framework.
- **Sequelize** - Promise-based ORM (Object-Relational Mapping) for Node.js used for interacting with databases.
- **SQLite** - Lightweight relational SQL database used for storing transactions.
- **Ethers.js** - Library for interacting with the Ethereum network.
- **TypeScript** - Statically typed superset of JavaScript used for development.
- **Nodemon** - Tool for automatically restarting the application when file changes are detected.
- **Async** - A utility module for working with asynchronous JavaScript, used to handle rate limiting.
- **p-limit** - Limits the number of concurrent promises, used to manage rate limits imposed by the Infura API.

## Prerequisites

1. **Infura Key:**
   To interact with the Ethereum network, you need an Infura API key. Register on [Infura](https://infura.io/) to obtain a free API key. Add your Infura key to the `.env` file.

## Installation

1. **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/ethereum-monitor.git
    cd ethereum-monitor
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Set up environment variables:**

    Create a `.env` file in the root directory of the project and add the necessary configurations. Example `.env` file:

    ```env
    INFURA_API_KEY=your-infura-api-key
    ```

## Running the Application

1. **Start the server in development mode:**

    ```bash
    npm run dev
    ```

    This will start the application with `nodemon`, which will automatically restart the server when code changes are detected.

2. **Start the server in production mode:**

    ```bash
    npm start
    ```

## API Endpoints

### Configurations

- **GET /api/configurations/**

  Retrieves all configurations.

- **POST /api/configurations/**

  Creates a new configuration. Requires configuration data in the request body.

- **PUT /api/configurations/:id**

  Updates an existing configuration by its identifier. Requires updated configuration data in the request body.

- **DELETE /api/configurations/:id**

  Deletes a configuration by its identifier.

### Transactions

- **GET /api/transactions/**

  Retrieves all transactions from the database.

- **GET /api/transactions/filter**

   Warning: Executing raw SQL queries directly can be dangerous and may expose your application to SQL injection attacks. Always validate and sanitize user inputs rigorously. Ensure that any SQL queries are carefully controlled and not directly executed based on user inputs.

  Executes an SQL query specified by the sql parameter in the request. This endpoint allows you to perform raw SQL queries against the transactions database. Here are some examples:

  Example 1: Retrieve transactions with a specific status

  GET http://localhost:8080/api/transactions/filter/query?sql=SELECT%20*%20FROM%20Transactions%20WHERE%20status%20=%20%27success%27

  Description: This query retrieves all transactions from the Transactions table where the status is 'success'

  Example 2: Retrieve transactions with a specific amount range

  GET http://localhost:8080/api/transactions/filter/query?sql=SELECT%20*%20FROM%20Transactions%20WHERE%20amount%20BETWEEN%20100%20AND%20200

  Description: This query retrieves all transactions where the amount is between 100 and 200.

  Example 3: Retrieve transactions with a specific sender address

  GET http://localhost:8080/api/transactions/filter/query?sql=SELECT%20*%20FROM%20Transactions%20WHERE%20senderAddress%20=%20%270x1234567890abcdef%27

  Description: This query retrieves all transactions where the sender address is '0x1234567890abcdef'.

  Example 4: Retrieve transactions within a specific date range
  
  GET http://localhost:8080/api/transactions/filter/query?sql=SELECT%20*%20FROM%20Transactions%20WHERE%20date%20BETWEEN%20%272024-01-01%27%20AND%20%272024-12-31%27

  Description: This query retrieves all transactions that occurred between January 1, 2024, and December 31, 2024.

Description of Query Parameter:

sql: This is the raw SQL query you want to execute. Ensure that the query is properly URL-encoded to handle special characters.

- **DELETE /api/transactions/**

Deletes all transactions from the database.

- **DELETE /api/transactions/filter**

Deletes transactions based on conditions specified by the `where` parameter in the request.

- **DELETE /api/transactions/:id**

Deletes a transaction by its identifier.

## Ethereum Service Overview

The Ethereum service handles interaction with the Ethereum network via Infura and monitors Ethereum transactions based on configurations stored in the database.

### Key Functions

- **`getEthereumService()`**: Retrieves the singleton instance of the Ethereum service.

- **`createEthereumService()`**: Initializes a new instance of the Ethereum service with the following features:
- Connects to the Ethereum network via Infura WebSocket provider.
- Monitors transactions in real-time, including pending transactions and blocks.
- Manages configurations and handles transactions based on user-defined criteria.
- Uses `async` and `p-limit` libraries to handle rate limiting due to Infura's API limits.

### Monitoring

- **Blocks**: Monitors new blocks and processes transactions within those blocks.
- **Pending Transactions**: Monitors pending transactions and processes them when they become available.

### Configuration Handling

- **Load Configurations**: Loads active configurations from the database.
- **Add/Update/Remove Configuration**: Allows for dynamic configuration changes and updates the monitoring accordingly.

## Notes

- The `async` and `p-limit` libraries are used to manage the rate limits imposed by the free Infura API key. These libraries ensure that the number of concurrent requests does not exceed Infura's limitations.

## License

The project is licensed under the [MIT License](LICENSE).

---

**Author**: Angel Stoyanov