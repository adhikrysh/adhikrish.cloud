FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html etc.html 404.html favicon.png og.png /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY font-licenses/ /usr/share/nginx/html/font-licenses/
EXPOSE 80
