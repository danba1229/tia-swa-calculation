'use client';

import { useEffect, useRef, useState } from 'react';
import { createSiteGeocoder, currentSiteLocation } from '../lib/siteGeocode';

export default function useSiteLocation(address) {
  const [state, setState] = useState({ address: '', lat: '', lng: '', status: 'idle', message: '상단에 주소지를 입력해 주세요.' });
  const geocoder = useRef(null);
  if (!geocoder.current) geocoder.current = createSiteGeocoder({ onState: setState });
  useEffect(() => {
    geocoder.current.lookup(address);
    return () => geocoder.current.cancel();
  }, [address]);
  return { ...currentSiteLocation(address, state), retry: () => geocoder.current.lookup(address) };
}
