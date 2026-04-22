import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UIMessage } from 'ai';
import type { CostRecord, Conversation, StoredSummary } from '../types';

// ============================================================
// DataStore Types Tests
// ============================================================
describe('datastore-types', () => {
  describe('Conversation interface', () => {
    it('should have required fields', () => {
      const conversation: Conversation = {
        id: 'conv-1',
        title: 'Test Conversation',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      expect(conversation.id).toBeDefined();
      expect(conversation.title).toBeDefined();
      expect(conversation.createdAt).toBeDefined();
      expect(conversation.updatedAt).toBeDefined();
    });
  });

  describe('StoredSummary interface', () => {
    it('should have required fields', () => {
      const summary: StoredSummary = {
        id: 'sum-1',
        conversationId: 'conv-1',
        summary: 'Test summary content',
        compactedAt: '2024-01-01T00:00:00Z',
        lastMessageOrder: 10,
        preCompactTokenCount: 50_000,
      };
      expect(summary.id).toBeDefined();
      expect(summary.conversationId).toBeDefined();
      expect(summary.summary).toBeDefined();
      expect(summary.compactedAt).toBeDefined();
      expect(summary.lastMessageOrder).toBeDefined();
      expect(summary.preCompactTokenCount).toBeDefined();
    });
  });

  describe('CostRecord interface', () => {
    it('should have required fields', () => {
      const cost: CostRecord = {
        id: 'cost-1',
        conversationId: 'conv-1',
        model: 'qwen-max',
        inputTokens: 10_000,
        outputTokens: 5_000,
        cachedReadTokens: 1_000,
        totalCostUsd: 0.05,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      expect(cost.id).toBeDefined();
      expect(cost.conversationId).toBeDefined();
      expect(cost.model).toBeDefined();
      expect(cost.inputTokens).toBeDefined();
      expect(cost.outputTokens).toBeDefined();
      expect(cost.totalCostUsd).toBeDefined();
    });
  });
});

// ============================================================
// Mock DataStore Tests (for interface validation)
// ============================================================
describe('datastore-mock', () => {
  // Mock implementation for testing interface contracts
  class MockConversationStore {
    private conversations: Map<string, Conversation> = new Map();

    createConversation(id: string, title?: string): Conversation {
      const conversation: Conversation = {
        id,
        title: title || 'New Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.conversations.set(id, conversation);
      return conversation;
    }

    getConversation(id: string): Conversation | null {
      return this.conversations.get(id) || null;
    }

    listConversations(): Conversation[] {
      return Array.from(this.conversations.values());
    }

    updateConversationTitle(id: string, title: string): void {
      const conv = this.conversations.get(id);
      if (conv) {
        conv.title = title;
        conv.updatedAt = new Date().toISOString();
      }
    }

    deleteConversation(id: string): void {
      this.conversations.delete(id);
    }
  }

  class MockMessageStore {
    private messages: Map<string, UIMessage[]> = new Map();

    getMessagesByConversation(conversationId: string): UIMessage[] {
      return this.messages.get(conversationId) || [];
    }

    saveMessages(conversationId: string, messages: UIMessage[]): void {
      this.messages.set(conversationId, messages);
    }

    getNextMessageOrder(conversationId: string): number {
      const msgs = this.messages.get(conversationId) || [];
      return msgs.length;
    }
  }

  class MockSummaryStore {
    private summaries: Map<string, StoredSummary> = new Map();

    saveSummary(
      conversationId: string,
      summary: string,
      lastMessageOrder: number,
      preCompactTokenCount: number
    ): StoredSummary {
      const stored: StoredSummary = {
        id: `sum-${Date.now()}`,
        conversationId,
        summary,
        compactedAt: new Date().toISOString(),
        lastMessageOrder,
        preCompactTokenCount,
      };
      this.summaries.set(conversationId, stored);
      return stored;
    }

    getSummaryById(id: string): StoredSummary | null {
      for (const summary of this.summaries.values()) {
        if (summary.id === id) return summary;
      }
      return null;
    }

    getSummaryByConversation(conversationId: string): StoredSummary | null {
      return this.summaries.get(conversationId) || null;
    }

    deleteSummariesByConversation(conversationId: string): void {
      this.summaries.delete(conversationId);
    }
  }

  class MockCostStore {
    private costs: Map<string, CostRecord> = new Map();

    ensureSchema(): void {}

    saveCostRecord(params: {
      conversationId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cachedReadTokens: number;
      totalCostUsd: number;
    }): CostRecord {
      const cost: CostRecord = {
        id: `cost-${Date.now()}`,
        conversationId: params.conversationId,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cachedReadTokens: params.cachedReadTokens,
        totalCostUsd: params.totalCostUsd,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.costs.set(params.conversationId, cost);
      return cost;
    }

    getCostByConversation(conversationId: string): CostRecord | null {
      return this.costs.get(conversationId) || null;
    }

    updateCostByConversation(
      conversationId: string,
      params: {
        inputTokens: number;
        outputTokens: number;
        cachedReadTokens: number;
        totalCostUsd: number;
      }
    ): void {
      const cost = this.costs.get(conversationId);
      if (cost) {
        cost.inputTokens = params.inputTokens;
        cost.outputTokens = params.outputTokens;
        cost.cachedReadTokens = params.cachedReadTokens;
        cost.totalCostUsd = params.totalCostUsd;
        cost.updatedAt = new Date().toISOString();
      }
    }
  }

  describe('MockConversationStore', () => {
    let store: MockConversationStore;

    beforeEach(() => {
      store = new MockConversationStore();
    });

    it('should create conversation', () => {
      const conv = store.createConversation('conv-1', 'Test');
      expect(conv.id).toBe('conv-1');
      expect(conv.title).toBe('Test');
    });

    it('should get conversation by id', () => {
      store.createConversation('conv-1', 'Test');
      const conv = store.getConversation('conv-1');
      expect(conv?.title).toBe('Test');
    });

    it('should return null for non-existent conversation', () => {
      expect(store.getConversation('non-existent')).toBeNull();
    });

    it('should list all conversations', () => {
      store.createConversation('conv-1', 'Test 1');
      store.createConversation('conv-2', 'Test 2');
      const list = store.listConversations();
      expect(list.length).toBe(2);
    });

    it('should update conversation title', () => {
      store.createConversation('conv-1', 'Old Title');
      store.updateConversationTitle('conv-1', 'New Title');
      const conv = store.getConversation('conv-1');
      expect(conv?.title).toBe('New Title');
    });

    it('should delete conversation', () => {
      store.createConversation('conv-1', 'Test');
      store.deleteConversation('conv-1');
      expect(store.getConversation('conv-1')).toBeNull();
    });
  });

  describe('MockMessageStore', () => {
    let store: MockMessageStore;

    beforeEach(() => {
      store = new MockMessageStore();
    });

    it('should save and retrieve messages', () => {
      const messages: UIMessage[] = [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      ];
      store.saveMessages('conv-1', messages);
      const retrieved = store.getMessagesByConversation('conv-1');
      expect(retrieved.length).toBe(2);
    });

    it('should return empty array for non-existent conversation', () => {
      const messages = store.getMessagesByConversation('non-existent');
      expect(messages.length).toBe(0);
    });

    it('should get next message order', () => {
      store.saveMessages('conv-1', [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'msg1' }] },
      ]);
      expect(store.getNextMessageOrder('conv-1')).toBe(1);
    });
  });

  describe('MockSummaryStore', () => {
    let store: MockSummaryStore;

    beforeEach(() => {
      store = new MockSummaryStore();
    });

    it('should save summary', () => {
      const summary = store.saveSummary('conv-1', 'Test summary', 10, 50_000);
      expect(summary.conversationId).toBe('conv-1');
      expect(summary.summary).toBe('Test summary');
      expect(summary.lastMessageOrder).toBe(10);
      expect(summary.preCompactTokenCount).toBe(50_000);
    });

    it('should get summary by conversation', () => {
      store.saveSummary('conv-1', 'Test summary', 10, 50_000);
      const summary = store.getSummaryByConversation('conv-1');
      expect(summary?.summary).toBe('Test summary');
    });

    it('should delete summaries', () => {
      store.saveSummary('conv-1', 'Test summary', 10, 50_000);
      store.deleteSummariesByConversation('conv-1');
      expect(store.getSummaryByConversation('conv-1')).toBeNull();
    });
  });

  describe('MockCostStore', () => {
    let store: MockCostStore;

    beforeEach(() => {
      store = new MockCostStore();
    });

    it('should save cost record', () => {
      const cost = store.saveCostRecord({
        conversationId: 'conv-1',
        model: 'qwen-max',
        inputTokens: 10_000,
        outputTokens: 5_000,
        cachedReadTokens: 1_000,
        totalCostUsd: 0.05,
      });
      expect(cost.conversationId).toBe('conv-1');
      expect(cost.model).toBe('qwen-max');
      expect(cost.totalCostUsd).toBe(0.05);
    });

    it('should get cost by conversation', () => {
      store.saveCostRecord({
        conversationId: 'conv-1',
        model: 'qwen-max',
        inputTokens: 10_000,
        outputTokens: 5_000,
        cachedReadTokens: 1_000,
        totalCostUsd: 0.05,
      });
      const cost = store.getCostByConversation('conv-1');
      expect(cost?.model).toBe('qwen-max');
    });

    it('should update cost record', () => {
      store.saveCostRecord({
        conversationId: 'conv-1',
        model: 'qwen-max',
        inputTokens: 10_000,
        outputTokens: 5_000,
        cachedReadTokens: 1_000,
        totalCostUsd: 0.05,
      });
      store.updateCostByConversation('conv-1', {
        inputTokens: 20_000,
        outputTokens: 10_000,
        cachedReadTokens: 2_000,
        totalCostUsd: 0.10,
      });
      const cost = store.getCostByConversation('conv-1');
      expect(cost?.inputTokens).toBe(20_000);
      expect(cost?.totalCostUsd).toBe(0.10);
    });
  });
});