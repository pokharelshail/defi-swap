import sys
import time
import numpy as np
import pandas as pd
import ccxt

# Inputs
name_base_btc = "BTC"
name_base_sol = "SOL"
name_base_eth = "ETH"
name_quote = "USDT"
timeframe_minute = "1m"  # Changed to minute data for real-time trading
initial_capital = 1000
exposure = 0.1  # Risk 10% of the wallet per trade
threshold = 0.01  # Set a threshold for significant BTC price movements

# Set up exchange connection
exchange = ccxt.binanceus()  # Use Binance US to avoid potential data issues
exchange.apiKey = 'YOUR_API_KEY'  # Replace with your API key
exchange.secret = 'YOUR_SECRET_KEY'  # Replace with your secret key

wallet = initial_capital

# Function to download real-time minute data
def download_data_live(name_base, name_quote, timeframe):
    ohlcv = exchange.fetch_ohlcv(name_base + '/' + name_quote, timeframe, limit=50)
    data = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    data['timestamp'] = pd.to_datetime(data['timestamp'], unit='ms')
    data['open'] = pd.to_numeric(data['open'])
    data['high'] = pd.to_numeric(data['high'])
    data['low'] = pd.to_numeric(data['low'])
    data['close'] = pd.to_numeric(data['close'])
    data['volume'] = pd.to_numeric(data['volume'])
    return data

# Real-time Trading Loop
def run_live_trading():
    global wallet
    while True:
        try:
            # Download data for BTC, SOL, and ETH
            data_btc = download_data_live(name_base_btc, name_quote, timeframe_minute)
            data_sol = download_data_live(name_base_sol, name_quote, timeframe_minute)
            data_eth = download_data_live(name_base_eth, name_quote, timeframe_minute)

            # Merge BTC, SOL, and ETH data on timestamp
            data = pd.merge(data_btc[['timestamp', 'close']], data_sol[['timestamp', 'close']], on='timestamp', suffixes=('_btc', '_sol'))
            data = pd.merge(data, data_eth[['timestamp', 'close']], on='timestamp')
            data.rename(columns={'close': 'close_eth'}, inplace=True)

            # Identify Significant BTC Price Movements
            data['btc_return'] = data['close_btc'].pct_change()
            data['significant_move'] = np.where(abs(data['btc_return']) > threshold, True, False)

            # Check the most recent significant move
            if data.iloc[-1]['significant_move']:
                btc_direction = np.sign(data.iloc[-1]['btc_return'])
                sol_return = (data.iloc[-1]['close_sol'] - data.iloc[-2]['close_sol']) / data.iloc[-2]['close_sol'] if data.iloc[-2]['close_sol'] != 0 else 0
                eth_return = (data.iloc[-1]['close_eth'] - data.iloc[-2]['close_eth']) / data.iloc[-2]['close_eth'] if data.iloc[-2]['close_eth'] != 0 else 0

                # Determine position size
                position_size = wallet * exposure

                # Execute trades based on BTC direction
                profit = 0
                if btc_direction > 0:
                    # Going long on SOL and ETH
                    profit += position_size * sol_return
                    profit += position_size * eth_return
                    # Place market orders for SOL and ETH
                    exchange.create_market_buy_order(f'{name_base_sol}/{name_quote}', position_size / data.iloc[-1]['close_sol'])
                    exchange.create_market_buy_order(f'{name_base_eth}/{name_quote}', position_size / data.iloc[-1]['close_eth'])
                elif btc_direction < 0:
                    # Going short on SOL and ETH
                    profit += position_size * (-sol_return)
                    profit += position_size * (-eth_return)
                    # Place market sell orders for SOL and ETH
                    exchange.create_market_sell_order(f'{name_base_sol}/{name_quote}', position_size / data.iloc[-1]['close_sol'])
                    exchange.create_market_sell_order(f'{name_base_eth}/{name_quote}', position_size / data.iloc[-1]['close_eth'])

                # Update wallet value
                wallet += profit
                print(f"Trade executed at {data.iloc[-1]['timestamp']}, New Wallet Balance: {wallet:.2f} USDT")

            # Pause for a minute before fetching new data
            time.sleep(60)

        except Exception as e:
            print(f"Error occurred: {e}")
            time.sleep(60)

# Run live trading
run_live_trading()
