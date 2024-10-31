import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import ta
from datetime import datetime
import ccxt

# Inputs
name_base_btc = "BTC"
name_base_eth = "ETH"
name_quote = "USDT"
timeframe_hourly = "1h"  
timeframe_daily = "1d"  
initial_capital = 1000
exposure = 0.1  # Risk 10% of the wallet per trade

# Download Data
def download_data(name_base, name_quote, timeframe, starting_date, ending_date):
    exchange = ccxt.binanceus()  # Use Binance US to avoid potential data issues
    since = exchange.parse8601(starting_date)
    ohlcv = exchange.fetch_ohlcv(name_base + '/' + name_quote, timeframe, since, limit=1000)
    data = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    data['timestamp'] = pd.to_datetime(data['timestamp'], unit='ms')
    data['open'] = pd.to_numeric(data['open'])
    data['high'] = pd.to_numeric(data['high'])
    data['low'] = pd.to_numeric(data['low'])
    data['close'] = pd.to_numeric(data['close'])
    data['volume'] = pd.to_numeric(data['volume'])
    return data

# Yearly Backtest Function
def run_yearly_backtest():
    starting_date_dl = "01 January 2021"
    ending_date_dl = "01 January 2022"

    data_btc = download_data(name_base_btc, name_quote, timeframe_daily, starting_date_dl, ending_date_dl)
    data_eth = download_data(name_base_eth, name_quote, timeframe_daily, starting_date_dl, ending_date_dl)

    
    data = pd.merge(data_btc[['timestamp', 'open', 'close']], data_eth[['timestamp', 'open', 'close']], on='timestamp', suffixes=('_btc', '_eth'))

    data.fillna(method='ffill', inplace=True)
    data.dropna(inplace=True)

    data = identify_significant_btc_movements(data, threshold=0.05)

    reactions = []
    for index, row in data.iterrows():
        if row['significant_move']:
            btc_direction = np.sign(row['btc_return'])
            eth_return = (row['close_eth'] - row['open_eth']) / row['open_eth'] if row['open_eth'] != 0 else 0
            reactions.append({'timestamp': row['timestamp'], 'btc_direction': btc_direction, 'eth_return': eth_return})
    reactions_df = pd.DataFrame(reactions)

    # Backtest Strategy Based on BTC Movements
    final_wallet = backtest_eth_on_btc_movements(reactions_df, initial_capital, exposure)

    # Print Results
    print(f"Yearly Backtest Results:")
    print(f"Initial Capital: {initial_capital} {name_quote}")
    print(f"Final Wallet after Backtest: {final_wallet:.2f} {name_quote}")
    print(f"Net Profit: {((final_wallet - initial_capital) / initial_capital) * 100:.2f}%")


def run_daily_backtest():
    starting_date_dl = "01 January 2022 00:00:00"
    ending_date_dl = "01 January 2022 23:59:59"

    
    data_btc = download_data(name_base_btc, name_quote, timeframe_hourly, starting_date_dl, ending_date_dl)
    data_eth = download_data(name_base_eth, name_quote, timeframe_hourly, starting_date_dl, ending_date_dl)

   
    data = pd.merge(data_btc[['timestamp', 'open', 'close']], data_eth[['timestamp', 'open', 'close']], on='timestamp', suffixes=('_btc', '_eth'))

    data.fillna(method='ffill', inplace=True)
    data.dropna(inplace=True)

   
    data = identify_significant_btc_movements(data, threshold=0.01)

    reactions_df = analyze_eth_reactions(data)

    
    final_wallet = backtest_eth_on_btc_movements(reactions_df, initial_capital, exposure)

  
    print(f"Daily Backtest Results:")
    print(f"Initial Capital: {initial_capital} {name_quote}")
    print(f"Final Wallet after Backtest: {final_wallet:.2f} {name_quote}")
    print(f"Net Profit: {((final_wallet - initial_capital) / initial_capital) * 100:.2f}%")

# Identify Significant BTC Price Movements
def identify_significant_btc_movements(data, threshold=0.01):
    data['btc_return'] = data['close_btc'].pct_change()
    data['significant_move'] = np.where(abs(data['btc_return']) > threshold, True, False)
    return data

# Analyze Corresponding ETH Price Reactions
def analyze_eth_reactions(data):
    reactions = []
    for index, row in data.iterrows():
        if row['significant_move']:
            btc_direction = np.sign(row['btc_return'])
            eth_return = (row['close_eth'] - row['open_eth']) / row['open_eth'] if row['open_eth'] != 0 else 0
            reactions.append({'timestamp': row['timestamp'], 'btc_direction': btc_direction, 'eth_return': eth_return})
    return pd.DataFrame(reactions)


def backtest_eth_on_btc_movements(reactions_df, initial_capital=1000, exposure=0.1):
    wallet = initial_capital
    for _, reaction in reactions_df.iterrows():
        position_size = wallet * exposure  # Only risk a portion of the wallet
        if reaction['btc_direction'] > 0:
            profit = position_size * reaction['eth_return']
        elif reaction['btc_direction'] < 0:
            profit = position_size * (-reaction['eth_return'])
        else:
            profit = 0
        wallet += profit
    return wallet

# Run Yearly Backtest
run_yearly_backtest()

# Run Daily Backtest
run_daily_backtest()
