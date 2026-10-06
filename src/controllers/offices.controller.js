import { listOffices } from "../repositories/officeRepo.js";

export async function getOffices(req, res) {
  const offices = await listOffices();
  res.json({ items: offices });
}
