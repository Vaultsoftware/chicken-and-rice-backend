// ================================
// backend/utils/geocode.js
// ================================
import fetch from "node-fetch";

// 📌 Lightweight geocoder using OpenStreetMap Nominatim API
export async function geocodeAddress(address) {
  if (!address) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      address
    )}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "fastfolder-app" },
    });
    const data = await res.json();

    if (data?.[0]) {
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
      };
    }
  } catch (err) {
    console.error("Geocoding failed:", err.message);
  }

  return null;
}
