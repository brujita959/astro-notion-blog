import { APIResponseError, Client } from '@notionhq/client'
import retry from 'async-retry'
import ExifTransformer from 'exif-be-gone'
import fs, { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import {
  DATABASE_ID,
  NOTION_API_SECRET,
  NUMBER_OF_POSTS_PER_PAGE,
  REQUEST_TIMEOUT_MS,
} from '../../server-constants'
import type {
  Block,
  Database,
  FileObject,
  Post,
} from '../interfaces'
import type * as requestParams from './request-params'
import type * as responses from './responses'

const client = new Client({
  auth: NOTION_API_SECRET,
  notionVersion: '2022-06-28',
})

let postsCache: Post[] | null = null
let dbCache: Database | null = null

const numberOfRetry = 2

export async function getDatabase(): Promise<Database> {
  if (dbCache !== null) {
    return Promise.resolve(dbCache)
  }

  const res = await retry(
    async (bail) => {
      try {
        return (await client.databases.retrieve({
          database_id: DATABASE_ID,
        })) as responses.RetrieveDatabaseResponse
      } catch (error: unknown) {
        if (error instanceof APIResponseError) {
          if (error.status && error.status >= 400 && error.status < 500) {
            bail(error)
          }
        }
        throw error
      }
    },
    {
      retries: numberOfRetry,
    }
  )

  dbCache = _buildDatabase(res)
  return dbCache
}

export async function getAllPosts(): Promise<Post[]> {
  if (postsCache !== null) {
    return Promise.resolve(postsCache)
  }

  const params: requestParams.QueryDatabase = {
    database_id: DATABASE_ID,
    filter: {
      and: [
        {
          property: 'Published',
          checkbox: {
            equals: true,
          },
        },
      ],
    },
    page_size: 100,
  }

  let results: responses.PageObject[] = []
  while (true) {
    const res = await retry(
      async (bail) => {
        try {
          return (await client.databases.query(
            params as any
          )) as responses.QueryDatabaseResponse
        } catch (error: unknown) {
          if (error instanceof APIResponseError) {
            if (error.status && error.status >= 400 && error.status < 500) {
              bail(error)
            }
          }
          throw error
        }
      },
      {
        retries: numberOfRetry,
      }
    )

    results = results.concat(res.results)

    if (!res.has_more) {
      break
    }

    params['start_cursor'] = res.next_cursor as string
  }

  postsCache = results
    .filter((pageObject) => _validPageObject(pageObject))
    .map((pageObject) => _buildPost(pageObject))
  return postsCache
}

export async function getPosts(pageSize = 10): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts.slice(0, pageSize)
}

export async function getRankedPosts(pageSize = 10): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts.slice(0, pageSize)
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const allPosts = await getAllPosts()
  return allPosts.find((post) => post.Slug === slug) || null
}

export async function getPostByPageId(pageId: string): Promise<Post | null> {
  const allPosts = await getAllPosts()
  return allPosts.find((post) => post.PageId === pageId) || null
}

export async function getPostsByTag(tagName: string, pageSize = 10): Promise<Post[]> {
  return []
}

export async function getPostsByPage(page: number): Promise<Post[]> {
  const allPosts = await getAllPosts()
  return allPosts
}

export async function getPostsByTagAndPage(tagName: string, page: number): Promise<Post[]> {
  return []
}

export async function getNumberOfPages(): Promise<number> {
  return 1
}

export async function getNumberOfPagesByTag(tagName: string): Promise<number> {
  return 1
}

export async function getAllBlocksByBlockId(blockId: string): Promise<Block[]> {
  return []
}

function _validPageObject(pageObject: responses.PageObject): boolean {
  return true
}

function _buildPost(pageObject: responses.PageObject): Post {
  const properties = pageObject.properties as any
  
  const titleProps = properties['配信タイトル'] || properties['Name']
  const title = titleProps?.title?.[0]?.plain_text || '無題の配信'

  return {
    PageId: pageObject.id,
    Title: title,
    Slug: pageObject.id,
    Date: properties['配信日']?.date?.start || '',
    Tags: [],
    LastEditedTime: pageObject.last_edited_time,
    Excerpt: title,
    Rank: 0,
  }
}

function _buildDatabase(res: responses.RetrieveDatabaseResponse): Database {
  const title = res.title?.[0]?.plain_text || '歌枠まとめ'
  return {
    Title: title,
    Description: '',
    Icon: null,
    Cover: null,
  }
}
