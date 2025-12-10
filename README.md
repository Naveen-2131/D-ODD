# Deriv Trading Bot - Deployment Guide

This is a web-based Deriv trading bot with a "Fast Odd/Even" strategy.

## Prerequisites
- Node.js installed on your system.

## Installation
1. Unzip the files to a folder.
2. Open a terminal/command prompt in that folder.
3. Run the following command to install dependencies:
   ```bash
   npm install
   ```

## Configuration
The `.env` file contains your credentials and settings:
- `DERIV_APP_ID`: Your Deriv App ID
- `DERIV_API_TOKEN`: Your API Token
- `PORT`: Web server port (default 3000)

## Running the Bot
1. Start the server:
   ```bash
   node web-bot.js
   ```
2. Open your browser and go to:
   http://localhost:3000

## Usage
- Enter your settings in the web panel.
- Click **Start Bot** to begin trading.
- Click **Stop Bot** to pause.
- View live logs and profit in the dashboard.

## Security Note
Keep your `.env` file private as it contains your API token.
