package com.slopslurper.plugin.web;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Haalt de platte kaart (van bovenaf) van een wereld op bij BlueMap.
 *
 * BlueMap maakt voor zijn verre zoomniveaus ("lowres") gewone PNG-tegels. De bovenste helft is
 * de kleur, de onderste helft de hoogte. We halen ze via onze eigen webserver op: dan mag de
 * browser de pixels lezen en hoeft hij BlueMap zelf niet te kunnen bereiken.
 */
public final class MapTiles {

    private final String baseUrl;
    private final Supplier<Map<String, String>> mapIds;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    /** @param mapIds per wereldnaam het id van de BlueMap-kaart */
    public MapTiles(String blueMapUrl, Supplier<Map<String, String>> mapIds) {
        String url = blueMapUrl.replaceAll("[#?].*$", "");
        this.baseUrl = url.endsWith("/") ? url : url + "/";
        this.mapIds = mapIds;
    }

    /** Instellingen van de kaart (tegelgrootte, zoomniveaus) als JSON, of {@code null}. */
    byte[] settings(String world) throws Exception {
        return fetch(world, "settings.json");
    }

    /** Eén PNG-tegel, of {@code null} als die er niet is. */
    byte[] tile(String world, int lod, int x, int z) throws Exception {
        String path = "x" + digits(x) + "z" + digits(z);
        return fetch(world, "tiles/" + lod + "/" + path.substring(0, path.length() - 1) + ".png");
    }

    /** BlueMap zet elk cijfer in een eigen map: -12 wordt "-1/2/". */
    private static String digits(int n) {
        return Integer.toString(n).replaceAll("(\\d)", "$1/");
    }

    private byte[] fetch(String world, String path) throws Exception {
        String mapId = mapIds.get().get(world);
        if (mapId == null) {
            return null;
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "maps/" + mapId + "/" + path))
                .timeout(Duration.ofSeconds(5)).build();
        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        // BlueMap geeft 204 voor een tegel die nog niet gerenderd is
        return response.statusCode() == 200 && response.body().length > 0 ? response.body() : null;
    }
}
