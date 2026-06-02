import type { StockRepository } from '../../db/repositories';
import type { Stock } from '../../db/types';

export class StockService {
  constructor(private readonly repo: StockRepository) {}

  async listStocks(): Promise<Stock[]> {
    return this.repo.findAll();
  }

  async getStock(id: string): Promise<Stock | null> {
    return this.repo.findById(id);
  }
}
