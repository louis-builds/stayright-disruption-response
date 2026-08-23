import { apiGet } from "../../shared/api/client";
import type { BookingSummary } from "./types";

export function fetchMyBookings() {
  return apiGet<BookingSummary[]>("/api/bookings/mine");
}
