-- Increase video upload size limit to 1GB
UPDATE storage.buckets
SET file_size_limit = 1073741824
WHERE id = 'videos';
