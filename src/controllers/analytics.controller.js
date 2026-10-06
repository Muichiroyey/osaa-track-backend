import * as repo from "../repositories/analyticsRepo.js";

export async function getAnalytics(req, res) {
  const data = await repo.getAnalytics();
  res.json(data);
}
