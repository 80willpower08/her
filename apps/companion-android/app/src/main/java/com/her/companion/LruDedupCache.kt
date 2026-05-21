package com.her.companion

/**
 * Tiny LRU+TTL cache used to drop duplicate notifications fired within a short
 * window (Android sometimes re-posts a notification when its content updates,
 * which would otherwise produce noise).
 */
class LruDedupCache(private val capacity: Int, private val windowMs: Long) {
    private val map = LinkedHashMap<String, Long>(capacity, 0.75f, true)

    @Synchronized
    fun seenRecently(key: String): Boolean {
        val now = System.currentTimeMillis()
        // Evict aged entries first.
        val it = map.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (now - e.value > windowMs) it.remove()
        }
        val prev = map[key]
        if (prev != null && now - prev <= windowMs) {
            map[key] = now  // refresh LRU position
            return true
        }
        map[key] = now
        if (map.size > capacity) {
            map.remove(map.entries.iterator().next().key)
        }
        return false
    }
}
