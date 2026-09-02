import { useEffect, useRef, useState } from "react";
import { useGoogleMapsScript } from "../auth/useGoogleMapsScript";
import * as api from "./api";

const DARK_MAP: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0b192a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b192a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7690a8" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#294157" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#10243a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1b3348" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#061321" }] },
];

export function DisruptionLiveMap({ disruptionId }: { disruptionId: string }) {
  const { ready, error } = useGoogleMapsScript();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number; radiusKm: number | null } | null>(null);

  useEffect(() => {
    let current = true;
    void api.fetchDisruption(disruptionId).then((res) => {
      if (!current || res.code !== 0 || res.data.lat === null || res.data.lng === null) return;
      setPoint({ lat: res.data.lat, lng: res.data.lng, radiusKm: res.data.radiusKm });
    });
    return () => { current = false; };
  }, [disruptionId]);

  useEffect(() => {
    if (!ready || !point || !hostRef.current) return;
    const center = { lat: point.lat, lng: point.lng };
    const map = mapRef.current ?? new google.maps.Map(hostRef.current, {
      center, zoom: point.radiusKm && point.radiusKm > 60 ? 7 : 9, styles: DARK_MAP,
      disableDefaultUI: true, gestureHandling: "cooperative", backgroundColor: "#081525",
    });
    map.setCenter(center);
    markerRef.current?.setMap(null);
    circleRef.current?.setMap(null);
    markerRef.current = new google.maps.Marker({ map, position: center, title: "Disruption epicentre" });
    if (point.radiusKm && point.radiusKm > 0) {
      circleRef.current = new google.maps.Circle({ map, center, radius: point.radiusKm * 1000,
        strokeColor: "#3d91ff", strokeOpacity: .9, strokeWeight: 1.5, fillColor: "#2078dc", fillOpacity: .16 });
      const bounds = circleRef.current.getBounds();
      if (bounds) map.fitBounds(bounds);
    }
    mapRef.current = map;
  }, [ready, point]);

  if (error || !point) return null;
  return <div ref={hostRef} className="tg-major-live-map" aria-label="Live map of disruption location" />;
}
