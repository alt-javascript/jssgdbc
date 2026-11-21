FROM eclipse-temurin:21.0.7_6-jre-jammy
# Official Apache distribution, verified against archive.apache.org SHA-512.
ADD https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-5.4.0.tar.gz /tmp/fuseki.tar.gz
RUN echo '41a161d058e3f5ee96f2f4e49494cb4b1ca7413d575465f90e312e2a2711adc2e4bb91dcc6fb6f7006ff5d7c095beb4bb84fab3f055520d51b6d71ef975d601f  /tmp/fuseki.tar.gz' | sha512sum -c - \
 && tar xzf /tmp/fuseki.tar.gz -C /opt \
 && mv /opt/apache-jena-fuseki-5.4.0 /opt/fuseki \
 && rm /tmp/fuseki.tar.gz
ENV FUSEKI_HOME=/opt/fuseki FUSEKI_BASE=/tmp/fuseki-base
WORKDIR /opt/fuseki
ENTRYPOINT ["./fuseki-server"]
CMD ["--mem", "--update", "/ds"]
