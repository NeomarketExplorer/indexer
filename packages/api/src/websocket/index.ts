/**
 * WebSocket manager for real-time updates
 * wss://ws-subscriptions-clob.polymarket.com/ws
 */

export type WebSocketMessageType =
  | 'book'
  | 'last_trade_price'
  | 'price_change'
  | 'tick_size_change';

export interface WebSocketSubscription {
  type: WebSocketMessageType;
  assets_ids?: string[];
  market?: string;
}

export interface WebSocketMessage {
  type: WebSocketMessageType;
  asset_id?: string;
  market?: string;
  data: unknown;
  timestamp?: number;
}

export interface WebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (message: WebSocketMessage) => void;
  onParseError?: (error: unknown, rawData: string) => void;
}

export type MessageHandler = (message: WebSocketMessage) => void;

export class WebSocketManager {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private subscriptions: Map<string, WebSocketSubscription> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private config: WebSocketConfig;
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(config: WebSocketConfig = {}) {
    this.url = config.url ?? 'wss://ws-subscriptions-clob.polymarket.com/ws';
    this.reconnectInterval = config.reconnectInterval ?? 3000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.config = config;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.isConnecting) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.config.onOpen?.();

          // Resubscribe to all subscriptions
          this.subscriptions.forEach(sub => {
            this.send({ action: 'subscribe', ...sub });
          });

          resolve();
        };

        this.ws.onclose = () => {
          this.isConnecting = false;
          this.config.onClose?.();

          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          this.config.onError?.(error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            this.config.onParseError?.(error, event.data);
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Subscribe to a channel
   */
  subscribe(subscription: WebSocketSubscription, handler: MessageHandler): () => void {
    const key = this.getSubscriptionKey(subscription);

    // Store subscription
    this.subscriptions.set(key, subscription);

    // Store handler
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler);

    // Send subscription message
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ action: 'subscribe', ...subscription });
    }

    // Return unsubscribe function
    return () => {
      this.handlers.get(key)?.delete(handler);

      if (this.handlers.get(key)?.size === 0) {
        this.handlers.delete(key);
        this.subscriptions.delete(key);

        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ action: 'unsubscribe', ...subscription });
        }
      }
    };
  }

  /**
   * Subscribe to orderbook updates
   */
  subscribeToOrderbook(tokenIds: string[], handler: MessageHandler): () => void {
    return this.subscribe(
      { type: 'book', assets_ids: tokenIds },
      handler
    );
  }

  /**
   * Subscribe to price updates
   */
  subscribeToPrices(tokenIds: string[], handler: MessageHandler): () => void {
    return this.subscribe(
      { type: 'last_trade_price', assets_ids: tokenIds },
      handler
    );
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    this.config.onMessage?.(message);

    // Find matching handlers
    this.subscriptions.forEach((sub, key) => {
      if (this.messageMatchesSubscription(message, sub)) {
        this.handlers.get(key)?.forEach(handler => handler(message));
      }
    });
  }

  private messageMatchesSubscription(
    message: WebSocketMessage,
    subscription: WebSocketSubscription
  ): boolean {
    if (message.type !== subscription.type) {
      return false;
    }

    if (subscription.assets_ids && message.asset_id) {
      return subscription.assets_ids.includes(message.asset_id);
    }

    if (subscription.market && message.market) {
      return subscription.market === message.market;
    }

    return true;
  }

  private getSubscriptionKey(subscription: WebSocketSubscription): string {
    return JSON.stringify(subscription);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, Math.min(delay, 30000));
  }
}

/**
 * Create a WebSocket manager
 */
export function createWebSocketManager(config?: WebSocketConfig): WebSocketManager {
  return new WebSocketManager(config);
}
