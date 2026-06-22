# ============================================================
# UAVLogBook — PHP 8.2 + Apache Dockerfile
# Multi-stage: base → development → production
# ============================================================

# ── Base stage: shared dependencies ───────────────────────
FROM php:8.2-apache AS base

LABEL maintainer="UAVLogBook"
LABEL description="UAVLogBook PHP/Apache application server"

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    # PHP extension build deps
    libpng-dev \
    libjpeg-dev \
    libwebp-dev \
    libfreetype6-dev \
    libzip-dev \
    libonig-dev \
    libxml2-dev \
    libcurl4-openssl-dev \
    # Runtime tools
    curl \
    unzip \
    ffmpeg \          
    # ffmpeg for video thumbnail generation and metadata extraction
    # Remove the line above if your host is constrained on disk space (~200MB)
    # The app works without ffmpeg — pure-PHP MP4 atom parser is used as fallback
    && docker-php-ext-configure gd \
         --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install -j$(nproc) \
        pdo \
        pdo_mysql \
        mbstring \
        zip \
        gd \
        curl \
        opcache \
        bcmath \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Enable Apache modules
RUN a2enmod rewrite headers expires deflate remoteip

# Create upload directories with correct ownership
RUN mkdir -p \
        /var/www/uploads/logs \
        /var/www/uploads/videos \
    && chown -R www-data:www-data /var/www/uploads \
    && chmod -R 755 /var/www/uploads

# ── Development stage: adds Xdebug ────────────────────────
FROM base AS development

RUN pecl install xdebug \
    && docker-php-ext-enable xdebug \
    && echo "xdebug.mode=debug" >> /usr/local/etc/php/conf.d/xdebug.ini \
    && echo "xdebug.start_with_request=yes" >> /usr/local/etc/php/conf.d/xdebug.ini \
    && echo "xdebug.client_host=host.docker.internal" >> /usr/local/etc/php/conf.d/xdebug.ini \
    && echo "xdebug.client_port=9003" >> /usr/local/etc/php/conf.d/xdebug.ini

# ── Production stage: copies source, sets opcache ─────────
FROM base AS production

# Opcache for production performance
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.memory_consumption=128" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.max_accelerated_files=4000" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.validate_timestamps=0" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.fast_shutdown=1" >> /usr/local/etc/php/conf.d/opcache.ini

# Copy PHP server source into image
# (in dev, this is overridden by bind-mount)
COPY server/ /var/www/html/api/

# Set ownership
RUN chown -R www-data:www-data /var/www/html \
    && find /var/www/html -type f -name "*.php" -exec chmod 644 {} \; \
    && find /var/www/html -type d -exec chmod 755 {} \;

# Health check endpoint (Apache ping)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost/api/v1/auth/login -X POST \
        -H "Content-Type: application/json" \
        -d '{"email":"x","password":"x"}' | grep -q "error" || exit 1

EXPOSE 80
