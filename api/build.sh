#!/bin/bash

source .env

docker buildx build --platform linux/amd64 -t $DOCKER_IMAGE_NAME --push .
