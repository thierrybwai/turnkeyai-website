// Edge geolocation endpoint — returns the visitor's country/region from Netlify's
// edge geo data so the client can decide whether to suggest the French version.
// No IP is exposed, nothing is stored. Used by assets/shared.js (language banner).
// Docs: context.geo → { country:{code,name}, subdivision:{code,name}, city, ... }
export default async (request, context) => {
  const g = context.geo || {};
  const body = JSON.stringify({
    country: (g.country && g.country.code) || "",
    subdivision: (g.subdivision && g.subdivision.code) || "",
    city: g.city || "",
  });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // per-visitor, never cache on the CDN
      "cache-control": "no-store",
      "netlify-vary": "country",
    },
  });
};

export const config = { path: "/tk-geo" };
