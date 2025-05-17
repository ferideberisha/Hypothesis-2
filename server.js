const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// Configuration
const PORT = 3000;
const NODERED_WS_URL = "ws://localhost:1880/smart-bins";
const CSV_PATH = "./smart_bin_metrics.csv";

// Data store
const dataStore = {
  metrics: [],
  bins: [],
  lastUpdate: null,
};

// Create HTTP server
const server = http.createServer((req, res) => {
  // Serve the dashboard HTML file
  if (req.url === "/" || req.url === "/index.html") {
    fs.readFile(path.join(__dirname, "dashboard.html"), "utf8", (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Error loading dashboard.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  }
  // API endpoint to get current data
  else if (req.url === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        metrics: dataStore.metrics,
        bins: dataStore.bins,
        lastUpdate: dataStore.lastUpdate,
      })
    );
  }
  // API endpoint to get data from CSV file
  else if (req.url === "/api/csv-data") {
    const results = [];
    // Check if CSV file exists
    if (!fs.existsSync(CSV_PATH)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSV file not found" }));
      return;
    }

    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(results));
      })
      .on("error", (err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
  }
  // For any other request, return 404
  else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections from clients
wss.on("connection", (ws) => {
  console.log("Client connected");

  // Send current data to the new client
  if (dataStore.lastUpdate) {
    ws.send(
      JSON.stringify({
        metrics: dataStore.metrics[dataStore.metrics.length - 1],
        bins: dataStore.bins,
        lastUpdate: dataStore.lastUpdate,
      })
    );
  }

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Connect to Node-RED WebSocket
let nodeRedWs;
function connectToNodeRed() {
  nodeRedWs = new WebSocket(NODERED_WS_URL);

  nodeRedWs.on("open", () => {
    console.log("Connected to Node-RED WebSocket");
  });

  nodeRedWs.on("message", (data) => {
    console.log("Received from Node-RED:", data); // 👈 Add this
    try {
      const parsedData = JSON.parse(data);

      // Update data store
      if (parsedData.metrics) {
        dataStore.metrics.push(parsedData.metrics);
        // Keep only last 100 metrics
        if (dataStore.metrics.length > 100) {
          dataStore.metrics.shift();
        }
      }

      if (parsedData.bins && parsedData.bins.length > 0) {
        dataStore.bins = parsedData.bins;
      }

      dataStore.lastUpdate = new Date().toISOString();

      // Broadcast to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    } catch (error) {
      console.error("Error processing data from Node-RED:", error);
    }
  });

  nodeRedWs.on("close", () => {
    console.log(
      "Disconnected from Node-RED. Attempting to reconnect in 5 seconds..."
    );
    setTimeout(connectToNodeRed, 5000);
  });

  nodeRedWs.on("error", (error) => {
    console.error("Node-RED WebSocket error:", error.message);
  });
}

// Check if CSV file exists and load initial data
function loadInitialData() {
  if (fs.existsSync(CSV_PATH)) {
    const results = [];
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        if (results.length > 0) {
          // Convert string values to numbers where appropriate
          results.forEach((row) => {
            Object.keys(row).forEach((key) => {
              if (!isNaN(row[key])) {
                row[key] = parseFloat(row[key]);
              }
            });
          });

          dataStore.metrics = results.slice(-100); // Keep only last 100 records
          console.log(
            `Loaded ${dataStore.metrics.length} records from CSV file`
          );
        }
      });
  }
}
// Example of WebSocket connection troubleshooting in browser console
const socket = new WebSocket("ws://127.0.0.1:1880/smart-bins");
socket.onopen = () => console.log("Connected!");
socket.onmessage = (event) => console.log("Received:", event.data);
socket.onerror = (error) => console.error("Error:", error);

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  loadInitialData();
  connectToNodeRed();
});
