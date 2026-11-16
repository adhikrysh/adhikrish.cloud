FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html txt.html src.html projects.html 404.html favicon.png og.png /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY projects/ /usr/share/nginx/html/projects/
COPY src/ /usr/share/nginx/html/src/
COPY font-licenses/ /usr/share/nginx/html/font-licenses/
EXPOSE 80
