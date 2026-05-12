FROM nginx:alpine
COPY index.html /usr/share/nginx/html/
COPY favicon.jpg /usr/share/nginx/html/
EXPOSE 80
