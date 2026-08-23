import { useEffect, useRef } from "react";
import { useGoogleMapsScript } from "./useGoogleMapsScript";
import "./MapPicker.css";

interface MapPickerProps {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number, address?: string) => void;
}

const DEFAULT_CENTER = { lat: -41.2865, lng: 174.7762 }; // Wellington, NZ

export function MapPicker({ lat, lng, onPick }: MapPickerProps) {
  const { ready, error } = useGoogleMapsScript();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!ready || !mapDivRef.current || mapRef.current) return;

    const center = lat || lng ? { lat, lng } : DEFAULT_CENTER;
    const map = new google.maps.Map(mapDivRef.current, {
      center,
      zoom: lat || lng ? 14 : 6,
      streetViewControl: false,
      mapTypeControl: false,
    });
    const marker = new google.maps.Marker({ map, position: center, draggable: true });
    const geocoder = new google.maps.Geocoder();

    const placeMarker = (position: google.maps.LatLng) => {
      marker.setPosition(position);
      geocoder.geocode({ location: position }, (results, status) => {
        const address = status === "OK" ? results?.[0]?.formatted_address : undefined;
        onPickRef.current(position.lat(), position.lng(), address);
      });
    };

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) placeMarker(e.latLng);
    });
    marker.addListener("dragend", () => {
      const position = marker.getPosition();
      if (position) placeMarker(position);
    });

    mapRef.current = map;
    markerRef.current = marker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (error) {
    return (
      <div className="map-picker-fallback">
        <p className="map-picker-error">Map unavailable: {error}</p>
        <div className="map-picker-manual">
          <label>
            <span>Lat</span>
            <input type="number" step="0.0001" value={lat || ""} onChange={(e) => onPick(Number(e.target.value) || 0, lng)} />
          </label>
          <label>
            <span>Lng</span>
            <input type="number" step="0.0001" value={lng || ""} onChange={(e) => onPick(lat, Number(e.target.value) || 0)} />
          </label>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="map-picker-loading">Loading map…</div>;

  return (
    <div>
      <div ref={mapDivRef} className="map-picker" />
      <p className="map-picker-hint">
        Click the map or drag the marker to choose the hotel location
        {lat || lng ? ` · Selected ${lat.toFixed(4)}, ${lng.toFixed(4)}` : ""}
      </p>
    </div>
  );
}
